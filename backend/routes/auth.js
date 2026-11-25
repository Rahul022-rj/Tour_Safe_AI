// /api/auth -> register, login, profile, password change / forgot / reset, logout
//
// Digital ID consistency policy (registration):
//   The account and its Digital ID hash are saved in MongoDB first, then the hash is submitted to the blockchain
//   in the background. While the transaction is pending (or the chain is down) the ID shows as PENDING and is NOT
//   reported as VALID; the chain worker retries automatically until it is confirmed. Registration therefore never
//   fails just because the blockchain is unavailable, and no ID is ever claimed valid without an on-chain record.
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const User = require('../models/User');
const { signToken, requireAuth } = require('../middleware/auth');
const { loginLimiter, passwordResetLimiter, registerLimiter } = require('../middleware/security');
const { createSalt, computeIdHash } = require('../utils/digitalId');
const { validateRegistration, passwordProblems, isEmail, isPhone, normalizePhone, str } = require('../utils/validate');
const { submitInBackground } = require('../services/chainProofs');
const { sendPasswordResetEmail } = require('../services/notify');
const { audit } = require('../services/audit');
const { setTracking } = require('../services/tracking');
const { disconnectUser } = require('../socket');

const router = express.Router();

// Precomputed hash so a login for an unknown email takes as long as a real one (no account enumeration by timing)
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-password', 10);

// POST /api/auth/register  (tourists only; operator accounts are created by an administrator or the seed script)
router.post('/register', registerLimiter, async (req, res) => {
  const { errors, value } = validateRegistration(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ message: 'Please correct the highlighted fields', errors });

  if (await User.exists({ email: value.email })) {
    return res.status(409).json({ message: 'An account with this email already exists', errors: { email: 'Already registered' } });
  }

  // role is forced to "tourist": nobody can register themselves as an operator
  const user = new User({ ...value, password: undefined, role: 'tourist', status: 'active' });
  user.passwordHash = await bcrypt.hash(value.password, config.bcryptRounds);
  user.passwordChangedAt = new Date();

  // Digital ID: random salt + SHA-256 hash of the details. Only the hash will be sent to the blockchain.
  user.salt = createSalt();
  user.idHash = computeIdHash(user, user.salt);
  user.idChainStatus = 'pending';
  await user.save(); // a duplicate email (two signups at once) throws 11000 -> 409

  submitInBackground('ID_REGISTER', user._id, user.idHash);
  await audit({ ...req, user: { id: user._id, role: 'tourist' } }, 'REGISTER', { targetType: 'User', targetId: user._id });
  res.status(201).json({
    token: signToken(user),
    user,
    digitalId: { idHash: user.idHash, chainStatus: 'pending', message: 'Digital ID created. Blockchain registration is in progress.' },
  });
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const email = str(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

  const user = await User.findOne({ email }).select('+passwordHash');
  // Same message for "no such user" and "wrong password", so attackers cannot discover valid emails
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) {
    await audit(req, 'LOGIN_FAILED', { details: { email: email.slice(0, 3) + '***' } });
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ message: 'This account is suspended. Contact the tourist help desk.', code: 'ACCOUNT_SUSPENDED' });
  }
  user.lastLoginAt = new Date();
  await user.save();
  await audit({ ...req, user: { id: user._id, role: user.role } }, 'LOGIN', { targetType: 'User', targetId: user._id });
  res.json({ token: signToken(user), user });
});

// GET /api/auth/me -> the logged-in user's profile (frontend calls this on page refresh)
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User no longer exists' });
  res.json({ user });
});

// PATCH /api/auth/me -> edit contact details. Identity fields (name, email, government ID, trip dates) are part of
// the Digital ID hash and cannot be edited here: changing them would invalidate the on-chain fingerprint.
router.patch('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User no longer exists' });
  const errors = {};
  const b = req.body || {};
  if (b.phone !== undefined) {
    if (!isPhone(b.phone)) errors.phone = 'Enter a valid phone number';
    else user.phone = normalizePhone(b.phone);
  }
  if (user.role === 'tourist') {
    if (b.nationality !== undefined) {
      if (!str(b.nationality, 60)) errors.nationality = 'Nationality is required';
      else user.nationality = str(b.nationality, 60);
    }
    if (b.emergencyContact) {
      const ec = b.emergencyContact;
      if (ec.name !== undefined) {
        if (str(ec.name, 100).length < 2) errors['emergencyContact.name'] = 'Name is required';
        else user.emergencyContact.name = str(ec.name, 100);
      }
      if (ec.phone !== undefined) {
        if (!isPhone(ec.phone)) errors['emergencyContact.phone'] = 'Enter a valid phone number';
        else user.emergencyContact.phone = normalizePhone(ec.phone);
      }
      if (ec.email !== undefined) {
        if (ec.email && !isEmail(ec.email)) errors['emergencyContact.email'] = 'Enter a valid email';
        else user.emergencyContact.email = str(ec.email, 254).toLowerCase() || undefined;
      }
      if (ec.relation !== undefined) user.emergencyContact.relation = str(ec.relation, 40);
    }
    if (b.notificationPrefs) {
      for (const k of ['email', 'sms', 'notifyEmergencyContact']) {
        if (typeof b.notificationPrefs[k] === 'boolean') user.notificationPrefs[k] = b.notificationPrefs[k];
      }
    }
  }
  for (const locked of ['name', 'email', 'govtId', 'tripStart', 'tripEnd', 'role', 'status']) {
    if (b[locked] !== undefined) errors[locked] = 'This field cannot be changed here';
  }
  if (Object.keys(errors).length) return res.status(400).json({ message: 'Please correct the highlighted fields', errors });
  await user.save();
  await audit(req, 'PROFILE_UPDATE', { targetType: 'User', targetId: user._id });
  res.json({ user });
});

// POST /api/auth/change-password  body: { currentPassword, newPassword, confirmPassword }
router.post('/change-password', requireAuth, passwordResetLimiter, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(String(currentPassword || ''), user.passwordHash))) {
    return res.status(400).json({ message: 'Current password is incorrect', errors: { currentPassword: 'Incorrect' } });
  }
  const problems = passwordProblems(newPassword);
  if (problems.length) return res.status(400).json({ message: `Password needs ${problems.join(', ')}`, errors: { newPassword: `Needs ${problems.join(', ')}` } });
  if (confirmPassword !== undefined && confirmPassword !== newPassword) return res.status(400).json({ message: 'Passwords do not match', errors: { confirmPassword: 'Does not match' } });
  if (await bcrypt.compare(newPassword, user.passwordHash)) return res.status(400).json({ message: 'New password must be different from the current one' });

  user.passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
  user.passwordChangedAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1; // logs out every other session
  await user.save();
  disconnectUser(user._id, 'Password changed');
  await audit(req, 'PASSWORD_CHANGE', { targetType: 'User', targetId: user._id });
  res.json({ message: 'Password changed. Other sessions have been logged out.', token: signToken(user) });
});

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// POST /api/auth/forgot-password  body: { email }
// Always answers the same way, whether or not the account exists.
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  const email = str(req.body?.email, 254).toLowerCase();
  const generic = { message: 'If an account exists for this email, a reset link has been sent.' };
  if (!isEmail(email)) return res.status(400).json({ message: 'Enter a valid email address' });

  const user = await User.findOne({ email, status: 'active' });
  if (!user) return res.json(generic);

  const token = crypto.randomBytes(32).toString('hex');
  await User.updateOne(
    { _id: user._id },
    { resetTokenHash: hashToken(token), resetTokenExpires: new Date(Date.now() + config.passwordResetMinutes * 60000) }
  );
  const link = `${config.clientUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
  const result = await sendPasswordResetEmail(user, link);
  await audit({ ...req, user: { id: user._id, role: user.role } }, 'PASSWORD_RESET_REQUEST', { targetType: 'User', targetId: user._id, details: { delivery: result?.status } });

  if (result?.status !== 'sent') {
    if (!config.isProduction) {
      // Development convenience ONLY: without an email provider the link is printed to the server console
      console.warn(`[auth] Email not delivered (${result?.status}). DEV reset link for ${email}: ${link}`);
    } else {
      console.error(`[auth] Password reset email could not be delivered: ${result?.error}`);
    }
  }
  res.json(generic);
});

// POST /api/auth/reset-password  body: { email, token, newPassword, confirmPassword }
router.post('/reset-password', passwordResetLimiter, async (req, res) => {
  const email = str(req.body?.email, 254).toLowerCase();
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const { newPassword, confirmPassword } = req.body || {};
  const invalid = { message: 'This reset link is invalid or has expired. Request a new one.' };
  if (!/^[0-9a-f]{64}$/.test(token) || !isEmail(email)) return res.status(400).json(invalid);

  const problems = passwordProblems(newPassword);
  if (problems.length) return res.status(400).json({ message: `Password needs ${problems.join(', ')}`, errors: { newPassword: `Needs ${problems.join(', ')}` } });
  if (confirmPassword !== undefined && confirmPassword !== newPassword) return res.status(400).json({ message: 'Passwords do not match', errors: { confirmPassword: 'Does not match' } });

  // Single use: the token is cleared in the same atomic update that sets the new password
  const passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
  const user = await User.findOneAndUpdate(
    { email, resetTokenHash: hashToken(token), resetTokenExpires: { $gt: new Date() } },
    { $set: { passwordHash, passwordChangedAt: new Date() }, $unset: { resetTokenHash: 1, resetTokenExpires: 1 }, $inc: { tokenVersion: 1 } },
    { new: true }
  );
  if (!user) return res.status(400).json(invalid);
  disconnectUser(user._id, 'Password reset');
  await audit({ ...req, user: { id: user._id, role: user.role } }, 'PASSWORD_RESET', { targetType: 'User', targetId: user._id });
  res.json({ message: 'Password updated. You can now log in with your new password.' });
});

// POST /api/auth/logout  body: { everywhere?: boolean }
// The browser deletes its token; "everywhere" also invalidates every other token of this account.
router.post('/logout', requireAuth, async (req, res) => {
  if (req.user.role === 'tourist') await setTracking(req.user.id, false);
  if (req.body?.everywhere) {
    await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
    disconnectUser(req.user.id, 'Logged out everywhere');
  }
  await audit(req, 'LOGOUT', { targetType: 'User', targetId: req.user.id });
  res.json({ message: 'Logged out' });
});

module.exports = router;
