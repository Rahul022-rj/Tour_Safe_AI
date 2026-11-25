// /api/safety -> check-in timer, journey monitoring (tourists) and broadcasts / overview (operators)
const express = require('express');
const SafetyCheckIn = require('../models/SafetyCheckIn');
const Journey = require('../models/Journey');
const Broadcast = require('../models/Broadcast');
const { requireAuth, requireRole } = require('../middleware/auth');
const safety = require('../services/safety');
const { audit } = require('../services/audit');

const router = express.Router();
const touristOnly = [requireAuth, requireRole('tourist')];
const operatorOnly = [requireAuth, requireRole('admin')];

// ----- Check-in timer (tourist) -----
router.get('/checkin', touristOnly, async (req, res) => {
  res.json({ checkIn: await safety.currentCheckIn(req.user.id) });
});
router.post('/checkin', touristOnly, async (req, res) => {
  const checkIn = await safety.startCheckIn(req.user.id, { minutes: req.body?.minutes, note: req.body?.note });
  await audit(req, 'CHECKIN_START', { targetType: 'SafetyCheckIn', targetId: checkIn._id, details: { minutes: checkIn.minutes } });
  res.status(201).json({ checkIn });
});
router.post('/checkin/safe', touristOnly, async (req, res) => {
  const checkIn = await safety.confirmSafe(req.user.id);
  await audit(req, 'CHECKIN_CONFIRM', { targetType: 'SafetyCheckIn', targetId: checkIn._id });
  res.json({ checkIn });
});
router.delete('/checkin', touristOnly, async (req, res) => {
  res.json({ checkIn: await safety.endCheckIn(req.user.id, 'cancelled') });
});

// ----- Journey monitoring (tourist) -----
router.get('/journey', touristOnly, async (req, res) => {
  res.json({ journey: await safety.currentJourney(req.user.id) });
});
router.post('/journey', touristOnly, async (req, res) => {
  const journey = await safety.startJourney(req.user.id, req.body || {});
  await audit(req, 'JOURNEY_START', { targetType: 'Journey', targetId: journey._id, details: { destination: journey.destinationName } });
  res.status(201).json({ journey });
});
router.post('/journey/end', touristOnly, async (req, res) => {
  const status = req.body?.arrived ? 'arrived' : 'cancelled';
  res.json({ journey: await safety.endJourney(req.user.id, status) });
});

// ----- Operator -----
// GET /api/safety/overview -> active / missed check-ins and active / overdue journeys
router.get('/overview', operatorOnly, async (req, res) => {
  const since = new Date(Date.now() - 24 * 3600e3);
  const populate = { path: 'touristId', select: 'name phone emergencyContact lastSeenAt' };
  const [checkIns, journeys] = await Promise.all([
    SafetyCheckIn.find({ $or: [{ status: 'active' }, { status: 'missed', missedAt: { $gte: since } }] }).sort({ dueAt: 1 }).populate(populate).lean(),
    Journey.find({ status: { $in: ['active', 'overdue'] } }).sort({ startedAt: -1 }).populate(populate).lean(),
  ]);
  res.json({ checkIns, journeys });
});

router.get('/broadcasts', operatorOnly, async (req, res) => {
  const broadcasts = await Broadcast.find().sort({ createdAt: -1 }).limit(100).populate('createdBy', 'name').lean();
  res.json({ broadcasts });
});
router.post('/broadcasts', operatorOnly, async (req, res) => {
  const doc = await safety.broadcast(req.user.id, req.body || {});
  await audit(req, 'BROADCAST_SEND', { targetType: 'Broadcast', targetId: doc._id, details: { target: doc.target, zone: doc.zoneName, recipients: doc.recipients } });
  res.status(201).json({ broadcast: doc });
});

module.exports = router;
