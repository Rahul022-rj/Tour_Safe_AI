// /api/tourists -> live location updates, tourist self-service data, and operator tourist management.
// IDOR protection: tourist endpoints only ever use req.user.id; :id endpoints are operator-only.
const express = require('express');
const config = require('../config');
const User = require('../models/User');
const Location = require('../models/Location');
const Alert = require('../models/Alert');
const Incident = require('../models/Incident');
const Notification = require('../models/Notification');
const { requireAuth, requireRole } = require('../middleware/auth');
const { recordLocation, setTracking } = require('../services/tracking');
const { getRecentAlerts, toPayload } = require('../services/alerts');
const { audit } = require('../services/audit');
const { isOnline, disconnectUser, emitToAdmins } = require('../socket');
const { isValidLatLng, isObjectId } = require('../utils/validate');
const { pagination, escapeRegex, dateRange, httpError } = require('../utils/http');

const router = express.Router();
const operatorOnly = [requireAuth, requireRole('admin')];
const touristOnly = [requireAuth, requireRole('tourist')];

// Operator-facing status of one tourist: sos > restricted > caution > safe, or stale / offline / no_data
function liveStatus(t, openSosIds, now = Date.now()) {
  if (openSosIds.has(String(t._id))) return 'sos';
  if (!t.lastSeenAt || !t.lastLocation?.coordinates?.length) return 'no_data';
  const age = now - new Date(t.lastSeenAt);
  if (!t.trackingActive || age > config.offlineAfterMs) return 'offline'; // stopped sharing / logged out
  if (age > config.staleAfterMs) return 'stale';
  return { red: 'restricted', yellow: 'caution', green: 'safe' }[t.lastZoneType] || 'safe';
}

const PUBLIC_FIELDS = 'name email phone nationality status tripStart tripEnd emergencyContact lastLocation lastAccuracy lastSource lastSeenAt trackingActive lastZoneId lastZoneType idHash idChainStatus idRevokedAt createdAt lastLoginAt';

async function openSosTouristIds() {
  const ids = await Incident.distinct('touristId', { type: 'SOS', status: { $ne: 'Resolved' } });
  return new Set(ids.map(String));
}

// ======================= Tourist (self) =======================

// POST /api/tourists/location  body: { lat, lng, accuracy?, speed?, heading? }
// Sent by the tourist's own browser (navigator.geolocation), always with the tourist's own JWT.
router.post('/location', touristOnly, async (req, res) => {
  const { lat, lng } = req.body || {};
  if (!isValidLatLng(lat, lng)) return res.status(400).json({ message: 'lat and lng must be numbers within range' });
  const optionalNumber = (v, min, max) => (v === undefined || v === null ? undefined : Number.isFinite(v) && v >= min && v <= max ? v : NaN);
  const accuracy = optionalNumber(req.body.accuracy, 0, 100000);
  const speed = optionalNumber(req.body.speed, 0, 1000);
  const heading = optionalNumber(req.body.heading, 0, 360);
  if ([accuracy, speed, heading].some(Number.isNaN)) return res.status(400).json({ message: 'accuracy, speed and heading must be numbers within range' });
  const source = 'gps'; // there is no simulated location source

  const update = await recordLocation(req.user.id, { lat, lng, accuracy, speed, heading, source });
  if (!update) return res.status(404).json({ message: 'User no longer exists' });
  res.status(201).json(update);
});

// POST /api/tourists/tracking  body: { active: boolean }
router.post('/tracking', touristOnly, async (req, res) => {
  if (typeof req.body?.active !== 'boolean') return res.status(400).json({ message: 'active must be true or false' });
  await setTracking(req.user.id, req.body.active);
  await audit(req, req.body.active ? 'TRACKING_START' : 'TRACKING_STOP', { targetType: 'User', targetId: req.user.id });
  res.json({ trackingActive: req.body.active });
});

// GET /api/tourists/me/locations?limit=200 -> own route history (newest first)
router.get('/me/locations', touristOnly, async (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
  const locations = await Location.find({ userId: req.user.id }).sort({ timestamp: -1 }).limit(limit).lean();
  res.json({ locations });
});

// GET /api/tourists/me/notifications -> in-app alerts about me + email/SMS delivery history
router.get('/me/notifications', touristOnly, async (req, res) => {
  const { limit, skip, page } = pagination(req.query, 30, 100);
  const filter = { touristId: req.user.id, audience: { $ne: 'operators' } };
  const [alerts, total, unread, deliveries] = await Promise.all([
    Alert.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Alert.countDocuments(filter),
    Alert.countDocuments({ ...filter, readByTourist: false }),
    Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(30).lean(),
  ]);
  res.json({ alerts: alerts.map(toPayload), total, unread, page, deliveries });
});

// POST /api/tourists/me/notifications/read -> mark all as read
router.post('/me/notifications/read', touristOnly, async (req, res) => {
  await Alert.updateMany({ touristId: req.user.id, readByTourist: false }, { readByTourist: true });
  res.json({ ok: true });
});

// ======================= Operator =======================

// GET /api/tourists?q=&status=&page=&limit= -> search tourists (with live status)
router.get('/', operatorOnly, async (req, res) => {
  const { page, limit, skip } = pagination(req.query, 100, 500);
  const filter = { role: 'tourist' };
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { nationality: rx }, { phone: rx }];
  }
  if (['active', 'suspended'].includes(req.query.account)) filter.status = req.query.account;
  const [docs, total, sos] = await Promise.all([
    User.find(filter).select(PUBLIC_FIELDS).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
    openSosTouristIds(),
  ]);
  let tourists = docs.map((t) => ({ ...t, liveStatus: liveStatus(t, sos), online: isOnline(t._id) }));
  if (req.query.status) tourists = tourists.filter((t) => t.liveStatus === req.query.status);
  res.json({ tourists, total, page, limit });
});

// GET /api/tourists/alerts?kind=&unreviewed=1 -> latest alerts for operators
router.get('/alerts', operatorOnly, async (req, res) => {
  if (!req.query.kind && !req.query.unreviewed && !req.query.from) return res.json({ alerts: await getRecentAlerts(50) });
  const filter = { audience: { $ne: 'tourist' } };
  if (req.query.kind) filter.kind = String(req.query.kind);
  if (req.query.unreviewed) filter.reviewedAt = null;
  const range = dateRange(req.query);
  if (range) filter.createdAt = range;
  const alerts = await Alert.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ alerts: alerts.map(toPayload) });
});

// POST /api/tourists/alerts/:alertId/review -> operator acknowledges an (anomaly) alert
router.post('/alerts/:alertId/review', operatorOnly, async (req, res) => {
  if (!isObjectId(req.params.alertId)) throw httpError(400, 'Invalid alert id');
  const alert = await Alert.findOneAndUpdate({ _id: req.params.alertId, reviewedAt: null }, { reviewedAt: new Date(), reviewedBy: req.user.id }, { new: true }).lean();
  if (!alert) return res.status(404).json({ message: 'Alert not found or already reviewed' });
  await audit(req, 'ALERT_REVIEW', { targetType: 'Alert', targetId: alert._id });
  const payload = toPayload(alert);
  emitToAdmins('alert:reviewed', { id: payload.id, reviewedAt: alert.reviewedAt });
  res.json({ alert: payload });
});

// GET /api/tourists/:id -> details for the operator
router.get('/:id', operatorOnly, async (req, res) => {
  if (!isObjectId(req.params.id)) throw httpError(400, 'Invalid tourist id');
  const t = await User.findOne({ _id: req.params.id, role: 'tourist' }).select(`${PUBLIC_FIELDS} govtIdType idTxHash idRevokeReason`).lean();
  if (!t) return res.status(404).json({ message: 'Tourist not found' });
  const [sos, incidents, alerts] = await Promise.all([
    openSosTouristIds(),
    Incident.find({ touristId: t._id }).sort({ createdAt: -1 }).limit(20).lean(),
    Alert.find({ touristId: t._id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  await audit(req, 'TOURIST_VIEW', { targetType: 'User', targetId: t._id });
  res.json({ tourist: { ...t, liveStatus: liveStatus(t, sos), online: isOnline(t._id) }, incidents, alerts: alerts.map(toPayload) });
});

// GET /api/tourists/:id/locations?from=&to=&limit= -> movement history for the operator
router.get('/:id/locations', operatorOnly, async (req, res) => {
  if (!isObjectId(req.params.id)) throw httpError(400, 'Invalid tourist id');
  const filter = { userId: req.params.id };
  const range = dateRange(req.query);
  if (range) filter.timestamp = range;
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 500));
  const locations = await Location.find(filter).sort({ timestamp: -1 }).limit(limit).lean();
  await audit(req, 'LOCATION_HISTORY_VIEW', { targetType: 'User', targetId: req.params.id });
  res.json({ locations });
});

// PATCH /api/tourists/:id/status  body: { status: 'active' | 'suspended', reason }
router.patch('/:id/status', operatorOnly, async (req, res) => {
  if (!isObjectId(req.params.id)) throw httpError(400, 'Invalid tourist id');
  const status = req.body?.status;
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ message: 'status must be active or suspended' });
  const update = status === 'suspended' ? { status, trackingActive: false, $inc: { tokenVersion: 1 } } : { status };
  const t = await User.findOneAndUpdate({ _id: req.params.id, role: 'tourist' }, update, { new: true }).select(PUBLIC_FIELDS).lean();
  if (!t) return res.status(404).json({ message: 'Tourist not found' });
  if (status === 'suspended') disconnectUser(t._id, 'Account suspended');
  await audit(req, status === 'suspended' ? 'TOURIST_SUSPEND' : 'TOURIST_ACTIVATE', { targetType: 'User', targetId: t._id, details: { reason: String(req.body.reason || '').slice(0, 200) } });
  res.json({ tourist: t });
});

module.exports = router;
module.exports.liveStatus = liveStatus;
