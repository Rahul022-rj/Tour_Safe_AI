// JWT helpers and Express middleware for authentication (who are you?) and authorization (what may you do?).
const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');

// The token holds only the user id, role and token version, no personal data
function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), role: user.role, tv: user.tokenVersion || 0 },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn, algorithm: 'HS256' }
  );
}

// Throws if the token is fake, tampered with or expired.
function verifyToken(token) {
  if (typeof token !== 'string' || !token) throw new Error('missing token');
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

// Verifies the token AND that the account still exists, is active and the token was not invalidated
// (password change/reset and suspension bump tokenVersion). Returns { id, role } or throws { status }.
async function authenticate(token) {
  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    throw Object.assign(new Error(expired ? 'Session expired, please log in again' : 'Invalid token, please log in again'), {
      status: 401,
      code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    });
  }
  const user = await User.findById(payload.id).select('role status tokenVersion name').lean();
  if (!user || (user.tokenVersion || 0) !== (payload.tv || 0)) {
    throw Object.assign(new Error('Session is no longer valid, please log in again'), { status: 401, code: 'TOKEN_REVOKED' });
  }
  if (user.status !== 'active') {
    throw Object.assign(new Error('This account is suspended. Contact the tourist help desk.'), { status: 403, code: 'ACCOUNT_SUSPENDED' });
  }
  return { id: String(user._id), role: user.role, name: user.name };
}

// Requires header "Authorization: Bearer <token>" and puts { id, role, name } on req.user
async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Login required (missing token)', code: 'TOKEN_MISSING' });
  }
  try {
    req.user = await authenticate(token);
    next();
  } catch (err) {
    if (!err.status) return next(err); // database down etc.
    return res.status(err.status).json({ message: err.message, code: err.code });
  }
}

// Use after requireAuth, e.g. requireRole('admin')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission for this action', code: 'FORBIDDEN' });
    }
    next();
  };
}

module.exports = { signToken, verifyToken, authenticate, requireAuth, requireRole };
