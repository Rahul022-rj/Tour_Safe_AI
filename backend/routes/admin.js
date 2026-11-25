// Operator-only endpoints: dashboard statistics, reports (JSON + CSV), audit log, notification history,
// system configuration status, and the experimental risk model.
const express = require('express');
const config = require('../config');
const User = require('../models/User');
const Incident = require('../models/Incident');
const Alert = require('../models/Alert');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const Zone = require('../models/Zone');
const RiskModel = require('../models/RiskModel');
const SafetyCheckIn = require('../models/SafetyCheckIn');
const Journey = require('../models/Journey');
const { requireAuth, requireRole } = require('../middleware/auth');
const chain = require('../services/blockchain');
const risk = require('../services/risk');
const { audit } = require('../services/audit');
const { onlineUserIds } = require('../socket');
const { pagination, dateRange } = require('../utils/http');
const { isValidLatLng } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

// GET /api/admin/stats -> every number on the operator dashboard, computed from the database
router.get('/stats', async (req, res) => {
  const now = Date.now();
  const staleCut = new Date(now - config.staleAfterMs);
  const dayAgo = new Date(now - 24 * 3600e3);
  const fresh = { role: 'tourist', lastSeenAt: { $gte: staleCut } };
  const [total, activeAccounts, activeTrips, tracked, caution, restricted, byStatus, alerts24h, unreviewed, zones, chainStatus] = await Promise.all([
    User.countDocuments({ role: 'tourist' }),
    User.countDocuments({ role: 'tourist', status: 'active' }),
    User.countDocuments({ role: 'tourist', status: 'active', tripStart: { $lte: new Date() }, tripEnd: { $gte: new Date() } }),
    User.countDocuments({ ...fresh, trackingActive: true }),
    User.countDocuments({ ...fresh, lastZoneType: 'yellow' }),
    User.countDocuments({ ...fresh, lastZoneType: 'red' }),
    Incident.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Alert.countDocuments({ audience: { $ne: 'tourist' }, createdAt: { $gte: dayAgo } }),
    Alert.countDocuments({ kind: 'ANOMALY', reviewedAt: null }),
    Zone.aggregate([{ $group: { _id: '$type', n: { $sum: 1 } } }]),
    chain.getChainStatus().then((s) => ({ ok: true, blockNumber: s.blockNumber, chainId: s.chainId })).catch((err) => ({ ok: false, error: err.message })),
  ]);
  const incidents = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
  const [activeCheckIns, missedCheckIns, activeJourneys, overdueJourneys] = await Promise.all([
    SafetyCheckIn.countDocuments({ status: 'active' }),
    SafetyCheckIn.countDocuments({ missedAt: { $gte: dayAgo } }), // still counted after a late "I'm safe"
    Journey.countDocuments({ status: 'active' }),
    Journey.countDocuments({ status: 'overdue' }),
  ]);
  const onlineIds = new Set(onlineUserIds());
  const tourists = await User.find({ role: 'tourist' }).select('_id').lean();
  res.json({
    tourists: { total, activeAccounts, activeTrips, tracked, inCaution: caution, inRestricted: restricted, online: tourists.filter((t) => onlineIds.has(String(t._id))).length },
    incidents: { reported: incidents.Reported || 0, assigned: incidents.Assigned || 0, resolved: incidents.Resolved || 0, open: (incidents.Reported || 0) + (incidents.Assigned || 0) },
    alerts: { last24h: alerts24h, unreviewedAnomalies: unreviewed },
    zones: Object.fromEntries(zones.map((z) => [z._id, z.n])),
    safety: { activeCheckIns, missedCheckIns, activeJourneys, overdueJourneys },
    blockchain: chainStatus,
    generatedAt: new Date(),
  });
});

// GET /api/admin/reports/summary?from=&to=
router.get('/reports/summary', async (req, res) => {
  const range = dateRange(req.query) || { $gte: new Date(Date.now() - 30 * 864e5) };
  const match = { createdAt: range };
  const [byStatus, byType, byDay, resolution, alertsByKind, newTourists, topZones] = await Promise.all([
    Incident.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Incident.aggregate([{ $match: match }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    Incident.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Incident.aggregate([
      { $match: { ...match, status: 'Resolved' } },
      { $project: { mins: { $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 60000] } } },
      { $group: { _id: null, avg: { $avg: '$mins' }, max: { $max: '$mins' }, n: { $sum: 1 } } },
    ]),
    Alert.aggregate([{ $match: { ...match, audience: { $ne: 'tourist' } } }, { $group: { _id: '$kind', n: { $sum: 1 } } }]),
    User.countDocuments({ role: 'tourist', createdAt: range }),
    Alert.aggregate([{ $match: { ...match, kind: 'ZONE_ENTRY' } }, { $group: { _id: '$zoneName', type: { $first: '$zoneType' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]),
  ]);
  const toObj = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
  res.json({
    range: { from: range.$gte || null, to: range.$lte || new Date() },
    incidents: { byStatus: toObj(byStatus), byType: toObj(byType), byDay: byDay.map((d) => ({ day: d._id, count: d.n })), resolution: resolution[0] ? { averageMinutes: Math.round(resolution[0].avg), maxMinutes: Math.round(resolution[0].max), count: resolution[0].n } : null },
    alerts: toObj(alertsByKind),
    newTourists,
    topZones: topZones.map((z) => ({ zone: z._id, type: z.type, entries: z.n })),
  });
});

// CSV helpers (values are quoted; formula-like cells are prefixed so spreadsheets do not execute them)
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
const toCsv = (header, rows) => [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');

// GET /api/admin/reports/export?type=incidents|alerts|tourists&from=&to=  -> CSV download
router.get('/reports/export', async (req, res) => {
  const type = String(req.query.type || 'incidents');
  const range = dateRange(req.query);
  const match = range ? { createdAt: range } : {};
  let csv;
  if (type === 'incidents') {
    const rows = await Incident.find(match).sort({ createdAt: -1 }).limit(10000).populate('touristId', 'name nationality').lean();
    csv = toCsv(
      ['id', 'createdAt', 'type', 'status', 'resolution', 'tourist', 'nationality', 'lat', 'lng', 'locationSource', 'address', 'assignedTo', 'message', 'chainStatus', 'chainTxHash', 'updatedAt'],
      rows.map((i) => [i._id, i.createdAt, i.type, i.status, i.resolution, i.touristId?.name, i.touristId?.nationality, i.location.coordinates[1], i.location.coordinates[0], i.locationSource, i.address, i.assignedTo, i.message, i.chainStatus, i.chainTxHash, i.updatedAt])
    );
  } else if (type === 'alerts') {
    const rows = await Alert.find({ ...match, audience: { $ne: 'tourist' } }).sort({ createdAt: -1 }).limit(10000).lean();
    csv = toCsv(['id', 'createdAt', 'kind', 'severity', 'tourist', 'zone', 'zoneType', 'lat', 'lng', 'message', 'reviewedAt'], rows.map((a) => [a._id, a.createdAt, a.kind, a.severity, a.touristName, a.zoneName, a.zoneType, a.lat, a.lng, a.message, a.reviewedAt]));
  } else if (type === 'tourists') {
    // No government ID numbers or passwords in exports
    const rows = await User.find({ role: 'tourist', ...match }).sort({ createdAt: -1 }).limit(10000).lean();
    csv = toCsv(['id', 'name', 'email', 'phone', 'nationality', 'status', 'tripStart', 'tripEnd', 'idChainStatus', 'idRevokedAt', 'lastSeenAt', 'lastZoneType', 'createdAt'], rows.map((u) => [u._id, u.name, u.email, u.phone, u.nationality, u.status, u.tripStart, u.tripEnd, u.idChainStatus, u.idRevokedAt, u.lastSeenAt, u.lastZoneType, u.createdAt]));
  } else {
    return res.status(400).json({ message: 'type must be incidents, alerts or tourists' });
  }
  await audit(req, 'REPORT_EXPORT', { details: { type, from: req.query.from, to: req.query.to } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="toursafe-${type}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv); // BOM so Excel opens UTF-8 correctly
});

// GET /api/admin/audit?action=&actor=&from=&to=&page=
router.get('/audit', async (req, res) => {
  const { page, limit, skip } = pagination(req.query, 50, 200);
  const filter = {};
  if (req.query.action) filter.action = String(req.query.action).toUpperCase();
  if (req.query.role) filter.actorRole = String(req.query.role);
  const range = dateRange(req.query);
  if (range) filter.createdAt = range;
  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actorId', 'name email role').lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ logs, total, page, limit });
});

// GET /api/admin/notifications?status=&channel=&page=
router.get('/notifications', async (req, res) => {
  const { page, limit, skip } = pagination(req.query, 50, 200);
  const filter = {};
  if (['sent', 'failed', 'not_configured', 'skipped'].includes(req.query.status)) filter.status = req.query.status;
  if (['email', 'sms'].includes(req.query.channel)) filter.channel = req.query.channel;
  const [notifications, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'name').lean(),
    Notification.countDocuments(filter),
  ]);
  res.json({ notifications, total, page, limit });
});

// GET /api/admin/system -> which optional services are configured (never returns secret values)
router.get('/system', async (req, res) => {
  let chainStatus;
  try {
    chainStatus = await chain.getChainStatus();
  } catch (err) {
    chainStatus = { ok: false, error: err.message };
  }
  res.json({
    environment: config.nodeEnv,
    email: { configured: config.emailConfigured, host: config.smtp.host || null },
    sms: { configured: config.smsConfigured, provider: config.smsConfigured ? 'twilio' : null },
    blockchain: { ...chainStatus, configuredChainId: config.chainId, requireChainForId: config.requireChainForId, confirmations: config.chainConfirmations },
    routing: { provider: config.osrmUrl, enabled: !config.disableExternalApis },
    geocoding: { provider: config.nominatimUrl, enabled: !config.disableExternalApis },
    places: { providers: config.overpassUrls, enabled: !config.disableExternalApis },
    tracking: { minIntervalMs: config.minLocationIntervalMs, staleAfterMs: config.staleAfterMs, offlineAfterMs: config.offlineAfterMs, retentionDays: config.locationRetentionDays, geofenceMaxAccuracyM: config.geofenceMaxAccuracyM },
    anomaly: { maxSpeedKmh: config.anomalyMaxSpeedKmh, inactivityMin: config.anomalyInactivityMin, restrictedDwellMin: config.anomalyRestrictedDwellMin },
    sosCooldownMs: config.sosCooldownMs,
  });
});

// GET /api/admin/operators, POST /api/admin/operators { name, email, password }
// Operator accounts can only be created by an existing operator (never by public registration).
router.get('/operators', async (req, res) => {
  const operators = await User.find({ role: 'admin' }).select('name email phone status lastLoginAt createdAt').sort({ name: 1 }).lean();
  res.json({ operators });
});

router.post('/operators', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { isEmail, passwordProblems, str } = require('../utils/validate');
  const name = str(req.body?.name, 100);
  const email = str(req.body?.email, 254).toLowerCase();
  const errors = {};
  if (name.length < 2) errors.name = 'Name is required';
  if (!isEmail(email)) errors.email = 'Enter a valid email';
  const pw = passwordProblems(req.body?.password);
  if (pw.length) errors.password = `Password needs ${pw.join(', ')}`;
  if (Object.keys(errors).length) return res.status(400).json({ message: 'Please correct the highlighted fields', errors });
  if (await User.exists({ email })) return res.status(409).json({ message: 'An account with this email already exists' });
  const op = await User.create({ name, email, role: 'admin', passwordHash: await bcrypt.hash(req.body.password, config.bcryptRounds), passwordChangedAt: new Date() });
  await audit(req, 'OPERATOR_CREATE', { targetType: 'User', targetId: op._id });
  res.status(201).json({ operator: op });
});

// ----- Experimental risk model -----
router.get('/risk/models', async (req, res) => {
  const models = await RiskModel.find().select('-tree').sort({ version: -1 }).limit(20).lean();
  res.json({ models, limitations: risk.LIMITATIONS });
});

router.post('/risk/train', async (req, res) => {
  const model = await risk.train(req.user.id);
  await audit(req, 'RISK_MODEL_TRAIN', { details: { version: model.version, status: model.status } });
  const { tree, ...rest } = model;
  res.status(201).json({ model: rest });
});

router.get('/risk/predict', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!isValidLatLng(lat, lng)) return res.status(400).json({ message: 'lat and lng must be valid coordinates' });
  const at = req.query.at ? new Date(String(req.query.at)) : new Date();
  if (Number.isNaN(at.getTime())) return res.status(400).json({ message: 'at must be a date' });
  res.json(await risk.predict({ lat, lng, at }));
});

module.exports = router;
