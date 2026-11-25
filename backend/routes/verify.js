// /api/verify -> Digital ID QR, ID verification against MongoDB + blockchain, revocation, incident integrity
//
// Digital ID verdicts:   VALID | UNKNOWN ID | TAMPERED | REVOKED | EXPIRED | NOT ON BLOCKCHAIN | BLOCKCHAIN UNAVAILABLE
// Incident verdicts:     INTACT | TAMPERED | PENDING | NOT CONFIRMED | NOT SUBMITTED | PROOF UNAVAILABLE | BLOCKCHAIN UNAVAILABLE
// VALID / INTACT are only returned when the blockchain was actually reached and confirmed the record.
const express = require('express');
const QRCode = require('qrcode');
const config = require('../config');
const User = require('../models/User');
const Incident = require('../models/Incident');
const ChainProof = require('../models/ChainProof');
const AuditLog = require('../models/AuditLog');
const { requireAuth, requireRole } = require('../middleware/auth');
const { computeIdHash } = require('../utils/digitalId');
const { computeIncidentHash } = require('../utils/incidentHash');
const { isObjectId, str } = require('../utils/validate');
const { httpError } = require('../utils/http');
const chain = require('../services/blockchain');
const chainProofs = require('../services/chainProofs');
const { notifyTourist } = require('../services/alerts');
const { audit } = require('../services/audit');

const router = express.Router();
const operatorOnly = [requireAuth, requireRole('admin')];

const QR_PREFIX = 'TSID:'; // marks our QR codes; the QR holds only the hash, no personal data
const isHash = (s) => typeof s === 'string' && /^0x[0-9a-f]{64}$/.test(s);
const normalizeHash = (s) => String(s || '').trim().replace(/^TSID:/i, '').toLowerCase();

// Details shown to the officer after a lookup (no government ID number)
const touristCard = (u) => ({
  id: String(u._id),
  name: u.name,
  nationality: u.nationality,
  phone: u.phone,
  tripStart: u.tripStart,
  tripEnd: u.tripEnd,
  emergencyContact: u.emergencyContact,
  status: u.status,
});

// Runs every check on one Digital ID and returns { valid, verdict, checks[], tourist, chain }
async function verifyDigitalId(idHash) {
  const user = await User.findOne({ idHash }).select('+salt').lean();
  let onChain = null;
  let chainError = null;
  try {
    onChain = await chain.getIdStatus(idHash); // { registered, revoked, valid }
  } catch (err) {
    chainError = err.message;
  }
  const chainCheck = (label, value, detailOk) =>
    onChain ? { label, ok: value, detail: detailOk } : { label, ok: false, unknown: true, detail: `Could not check: ${chainError}` };

  if (!user) {
    return {
      valid: false,
      verdict: 'UNKNOWN ID',
      checks: [
        { label: 'Tourist record found in database', ok: false, detail: 'No tourist has this ID' },
        chainCheck('Registered on blockchain', onChain?.registered),
      ],
      chainReachable: Boolean(onChain),
      checkedAt: new Date(),
    };
  }

  const untampered = computeIdHash(user, user.salt) === idHash; // recompute SHA-256(details + salt)
  const notExpired = new Date(user.tripEnd) >= new Date(); // expiry comes from tripEnd in MongoDB
  const dbRevoked = Boolean(user.idRevokedAt);
  const checks = [
    { label: 'Tourist record found in database', ok: true, detail: user.name },
    {
      label: 'Record matches the ID hash',
      ok: untampered,
      detail: untampered ? 'SHA-256(details + salt) recomputed and matches' : 'Recomputed hash differs: the stored details were changed',
    },
    chainCheck('Registered on blockchain', onChain?.registered, user.idTxHash ? `Tx ${user.idTxHash}` : undefined),
    { label: 'Not revoked (database)', ok: !dbRevoked, detail: dbRevoked ? `Revoked ${new Date(user.idRevokedAt).toLocaleString()}${user.idRevokeReason ? `: ${user.idRevokeReason}` : ''}` : undefined },
    chainCheck('Not revoked on blockchain', onChain ? !onChain.revoked : false),
    { label: 'Trip not expired', ok: notExpired, detail: `Trip ends ${new Date(user.tripEnd).toLocaleString()}` },
    { label: 'Account active', ok: user.status === 'active', detail: user.status },
  ];

  let verdict = 'VALID';
  if (!untampered) verdict = 'TAMPERED';
  else if (dbRevoked || onChain?.revoked) verdict = 'REVOKED';
  else if (!notExpired) verdict = 'EXPIRED';
  else if (!onChain) verdict = config.requireChainForId ? 'BLOCKCHAIN UNAVAILABLE' : 'VALID';
  else if (!onChain.registered) verdict = 'NOT ON BLOCKCHAIN';

  return {
    valid: verdict === 'VALID',
    verdict,
    checks,
    tourist: touristCard(user),
    chainStatus: user.idChainStatus,
    chainReachable: Boolean(onChain),
    chainNote: !onChain ? 'The blockchain could not be reached, so on-chain registration and revocation were not verified.' : undefined,
    pendingNote: verdict === 'NOT ON BLOCKCHAIN' && ['pending', 'failed'].includes(user.idChainStatus) ? 'Blockchain registration is still in progress; it is retried automatically.' : undefined,
    checkedAt: new Date(),
  };
}

// GET /api/verify/my-id -> the logged-in tourist's QR code and current ID status
router.get('/my-id', requireAuth, requireRole('tourist'), async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ message: 'User no longer exists' });
  const qr = await QRCode.toDataURL(QR_PREFIX + user.idHash, { width: 320, margin: 1, errorCorrectionLevel: 'M' }); // PNG as a data: URL
  const result = await verifyDigitalId(user.idHash);
  res.json({ idHash: user.idHash, idTxHash: user.idTxHash, chainStatus: user.idChainStatus, qr, qrText: QR_PREFIX + user.idHash, result });
});

// GET /api/verify/chain -> blockchain health (operators)
router.get('/chain', operatorOnly, async (req, res) => {
  const [counts] = await Promise.all([
    ChainProof.aggregate([{ $group: { _id: { kind: '$kind', status: '$status' }, n: { $sum: 1 } } }]),
  ]);
  const proofs = counts.map((c) => ({ kind: c._id.kind, status: c._id.status, count: c.n }));
  try {
    res.json({ ...(await chain.getChainStatus()), proofs, requireChainForId: config.requireChainForId });
  } catch (err) {
    res.json({ ok: false, error: err.message, code: err.code, proofs, requireChainForId: config.requireChainForId });
  }
});

// POST /api/verify/chain/retry -> retry failed / pending proofs now (operators)
router.post('/chain/retry', operatorOnly, async (req, res) => {
  const confirmed = await chainProofs.retryFailed();
  await audit(req, 'CHAIN_RETRY', { details: { confirmed } });
  res.json({ confirmed });
});

// GET /api/verify/proofs?kind=&status= -> recent blockchain proofs (operators)
router.get('/proofs', operatorOnly, async (req, res) => {
  const filter = {};
  if (['ID_REGISTER', 'ID_REVOKE', 'INCIDENT'].includes(req.query.kind)) filter.kind = req.query.kind;
  if (['pending', 'submitted', 'confirmed', 'failed'].includes(req.query.status)) filter.status = req.query.status;
  const proofs = await ChainProof.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ proofs });
});

// GET /api/verify/id/:idHash -> verify a scanned Digital ID (operators)
router.get('/id/:idHash', operatorOnly, async (req, res) => {
  const idHash = normalizeHash(req.params.idHash);
  if (!isHash(idHash)) return res.status(400).json({ message: 'Not a valid Digital ID (expected 0x + 64 hex characters)' });
  const result = await verifyDigitalId(idHash);
  await audit(req, 'ID_VERIFY', { targetType: 'DigitalId', targetId: idHash.slice(0, 18), details: { verdict: result.verdict } });
  res.json(result);
});

// POST /api/verify/id/:idHash/revoke  body: { reason }  -> revoke a Digital ID (operators)
// Revocation takes effect immediately in MongoDB (so verification answers REVOKED at once) and is written to the
// blockchain; the response reports whether the on-chain revocation is confirmed or still pending.
router.post('/id/:idHash/revoke', operatorOnly, async (req, res) => {
  const idHash = normalizeHash(req.params.idHash);
  if (!isHash(idHash)) return res.status(400).json({ message: 'Not a valid Digital ID' });
  const reason = str(req.body?.reason, 300);
  if (reason.length < 3) return res.status(400).json({ message: 'Enter a reason for the revocation' });
  const user = await User.findOneAndUpdate({ idHash, idRevokedAt: null }, { idRevokedAt: new Date(), idRevokeReason: reason }, { new: true });
  if (!user) {
    const exists = await User.exists({ idHash });
    return res.status(exists ? 409 : 404).json({ message: exists ? 'This ID is already revoked' : 'No tourist has this ID' });
  }
  await audit(req, 'ID_REVOKE', { targetType: 'User', targetId: user._id, details: { reason } });
  const proof = await chainProofs.submit('ID_REVOKE', user._id, idHash);
  await notifyTourist(user._id, 'Digital ID revoked', 'Your Digital ID was revoked by the authorities. Please contact the tourist help desk.', 'ID_REVOKED');
  res.json({ ...(await verifyDigitalId(idHash)), revocation: { chainStatus: proof.status, txHash: proof.txHash || null, error: proof.status === 'confirmed' ? undefined : proof.lastError } });
});

// GET /api/verify/revocations -> revocation history (operators)
router.get('/revocations', operatorOnly, async (req, res) => {
  const users = await User.find({ idRevokedAt: { $ne: null } }).select('name email idHash idRevokedAt idRevokeReason idRevokeTxHash').sort({ idRevokedAt: -1 }).limit(200).lean();
  const [proofs, logs] = await Promise.all([
    ChainProof.find({ kind: 'ID_REVOKE', refId: { $in: users.map((u) => u._id) } }).lean(),
    AuditLog.find({ action: 'ID_REVOKE', targetId: { $in: users.map((u) => String(u._id)) } }).populate('actorId', 'name').lean(),
  ]);
  const proofBy = new Map(proofs.map((p) => [String(p.refId), p]));
  const logBy = new Map(logs.map((l) => [l.targetId, l]));
  res.json({
    revocations: users.map((u) => ({
      touristId: String(u._id),
      name: u.name,
      idHash: u.idHash,
      revokedAt: u.idRevokedAt,
      reason: u.idRevokeReason,
      revokedBy: logBy.get(String(u._id))?.actorId?.name || null,
      chainStatus: proofBy.get(String(u._id))?.status || 'not_submitted',
      txHash: proofBy.get(String(u._id))?.txHash || u.idRevokeTxHash || null,
    })),
  });
});

// GET /api/verify/incident/:id -> recompute the incident hash and compare it with the recorded proofs (operators)
router.get('/incident/:id', operatorOnly, async (req, res) => {
  if (!isObjectId(req.params.id)) throw httpError(400, 'Invalid incident id');
  const incident = await Incident.findById(req.params.id).lean();
  if (!incident) return res.status(404).json({ message: 'Incident not found' });

  const recomputed = computeIncidentHash(incident);
  const proofs = await ChainProof.find({ kind: 'INCIDENT', refId: incident._id }).sort({ revision: 1, createdAt: 1 }).lean();
  const latest = proofs.at(-1);
  const matching = proofs.find((p) => p.hash === recomputed);

  let loggedAt = null;
  let chainErr = null;
  if (matching?.status === 'confirmed') {
    try {
      loggedAt = await chain.getIncidentLoggedAt(recomputed);
    } catch (err) {
      chainErr = err.message;
    }
  }

  const checks = [
    { label: 'Hash recomputed from the MongoDB record (canonical JSON, SHA-256)', ok: true, detail: recomputed },
    {
      label: 'Matches a proof recorded by TourSafe',
      ok: Boolean(matching),
      detail: matching ? `Revision ${matching.revision}, proof ${matching.status}` : proofs.length ? 'No recorded proof matches the current record' : 'No proof recorded yet',
    },
    {
      label: 'Matches the LATEST recorded state',
      ok: Boolean(matching && latest && matching.hash === latest.hash),
      detail: latest ? `Latest proof: revision ${latest.revision}` : undefined,
    },
    matching?.status === 'confirmed'
      ? chainErr
        ? { label: 'Hash exists on the blockchain', ok: false, unknown: true, detail: `Could not check: ${chainErr}` }
        : { label: 'Hash exists on the blockchain', ok: loggedAt > 0, detail: loggedAt ? `Logged ${new Date(loggedAt * 1000).toLocaleString()} (tx ${matching.txHash || 'n/a'})` : 'Not found on chain' }
      : { label: 'Hash exists on the blockchain', ok: false, detail: matching ? `Proof is ${matching.status}${matching.lastError ? `: ${matching.lastError}` : ''}` : 'n/a' },
  ];

  let verdict;
  if (!proofs.length) verdict = 'NOT SUBMITTED';
  else if (!matching) verdict = 'TAMPERED'; // the record no longer matches anything TourSafe recorded
  else if (matching.hash !== latest.hash) verdict = 'TAMPERED'; // rolled back to an older state
  else if (['pending', 'submitted'].includes(matching.status)) verdict = 'PENDING';
  else if (matching.status === 'failed') verdict = 'NOT CONFIRMED';
  else if (chainErr) verdict = 'BLOCKCHAIN UNAVAILABLE';
  else if (!loggedAt) verdict = 'PROOF UNAVAILABLE'; // confirmed earlier but missing now: the chain was reset
  else verdict = 'INTACT';

  await audit(req, 'INCIDENT_VERIFY', { targetType: 'Incident', targetId: incident._id, details: { verdict } });
  res.json({
    intact: verdict === 'INTACT',
    verdict,
    checks,
    recomputedHash: recomputed,
    proofs: proofs.map((p) => ({ revision: p.revision, hash: p.hash, status: p.status, txHash: p.txHash, blockNumber: p.blockNumber, confirmedAt: p.confirmedAt, attempts: p.attempts, lastError: p.lastError })),
    checkedAt: new Date(),
  });
});

module.exports = router;
module.exports.verifyDigitalId = verifyDigitalId;
