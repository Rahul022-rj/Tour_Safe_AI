// /api/incidents -> SOS button and the incident workflow: Reported -> Assigned -> Resolved
//
// Safety rules:
//  - The incident is saved and operators are alerted BEFORE anything slow happens (blockchain, email/SMS,
//    address lookup). Those run in the background and can never delay or break an SOS.
//  - Duplicate SOS presses within SOS_COOLDOWN_MS are ignored using a lock document in MongoDB, so the
//    protection also holds with several backend instances.
//  - Status changes follow the workflow strictly and use optimistic concurrency (revision) to stop two
//    operators overwriting each other.
const express = require('express');
const config = require('../config');
const Incident = require('../models/Incident');
const User = require('../models/User');
const Station = require('../models/Station');
const SosLock = require('../models/SosLock');
const ChainProof = require('../models/ChainProof');
const { requireAuth, requireRole } = require('../middleware/auth');
const { emitToAdmins, emitToUser } = require('../socket');
const { sendAlert, notifyTourist } = require('../services/alerts');
const { notifyEvent } = require('../services/notify');
const { submitInBackground } = require('../services/chainProofs');
const { reverseGeocode } = require('../services/geo');
const { audit } = require('../services/audit');
const { isValidLatLng, isObjectId, str } = require('../utils/validate');
const { computeIncidentHash } = require('../utils/incidentHash');
const { pagination, escapeRegex, dateRange, httpError } = require('../utils/http');

const router = express.Router();

// The only allowed next status for each status (no skipping, no going back)
const NEXT_STATUS = { Reported: ['Assigned', 'Resolved'], Assigned: ['Resolved'], Resolved: [] };

// Fields to fill in from other collections when sending an incident to the browser
const POPULATE_ADMIN = [
  { path: 'touristId', select: 'name phone nationality emergencyContact email' },
  { path: 'history.by', select: 'name role' },
  { path: 'notes.by', select: 'name role' },
  { path: 'nearestStation', select: 'name type phone source verified location' },
];
// A tourist sees their own incident without operator notes and with only operator names
const POPULATE_TOURIST = [
  { path: 'touristId', select: 'name' },
  { path: 'history.by', select: 'name role' },
  { path: 'nearestStation', select: 'name type phone source verified location' },
];
const forTourist = (inc) => {
  const { notes, ...rest } = inc;
  return rest;
};

// Send the latest version of an incident to every operator and to the tourist who raised it
async function broadcastIncident(incidentId) {
  const [adminView, touristView] = await Promise.all([
    Incident.findById(incidentId).populate(POPULATE_ADMIN).lean(),
    Incident.findById(incidentId).populate(POPULATE_TOURIST).lean(),
  ]);
  if (!adminView) return null;
  emitToAdmins('incident', adminView);
  emitToUser(String(touristView.touristId?._id || touristView.touristId), 'incident', forTourist(touristView));
  return { adminView, touristView: forTourist(touristView) };
}

// Hash the incident's current state and queue the blockchain proof (background; never throws)
async function queueProof(incidentId) {
  try {
    const incident = await Incident.findById(incidentId).lean();
    submitInBackground('INCIDENT', incident._id, computeIncidentHash(incident), incident.revision);
  } catch (err) {
    console.error(`[chain] could not hash incident ${incidentId}: ${err.message}`);
  }
}

// ----- Duplicate SOS protection (shared, persistent) -----
async function acquireSosLock(userId) {
  const now = new Date();
  try {
    await SosLock.findOneAndUpdate(
      { _id: userId, until: { $lte: now } },
      { $set: { until: new Date(now.getTime() + config.sosCooldownMs), incidentId: null, createdAt: now } },
      { upsert: true }
    );
    return { acquired: true };
  } catch (err) {
    if (err.code !== 11000) throw err;
    // The lock exists and has not expired: another SOS was accepted moments ago
    return { acquired: false, lock: await SosLock.findById(userId).lean() };
  }
}

// POST /api/incidents/sos  body: { lat, lng, accuracy, message }
// (lat/lng optional: falls back to the last known position)
router.post('/sos', requireAuth, requireRole('tourist'), async (req, res) => {
  const userId = req.user.id;
  const body = req.body || {};

  // Validate before taking the lock, so a malformed request does not block a real one
  const hasCoords = body.lat !== undefined || body.lng !== undefined;
  if (hasCoords && !isValidLatLng(body.lat, body.lng)) return res.status(400).json({ message: 'lat and lng must be valid numbers' });

  // 1. Ignore a repeat SOS within the cooldown
  const { acquired, lock } = await acquireSosLock(userId);
  if (!acquired) {
    const wait = Math.max(1, Math.ceil((new Date(lock.until) - Date.now()) / 1000));
    return res.status(200).json({
      duplicate: true,
      incidentId: lock.incidentId,
      retryAfterSeconds: wait,
      message: `SOS already sent, help is on the way. You can send another in ${wait}s.`,
    });
  }

  try {
    // 2. Where is the tourist? Use the position sent with the SOS, otherwise the last tracked position.
    const user = await User.findById(userId).lean();
    let coordinates = null;
    let locationSource = 'live';
    if (hasCoords) coordinates = [body.lng, body.lat];
    else if (user?.lastLocation?.coordinates?.length === 2) {
      coordinates = user.lastLocation.coordinates;
      locationSource = 'last_known';
    }
    if (!user || !coordinates) {
      await SosLock.deleteOne({ _id: userId }); // nothing was saved, so do not block the next attempt
      return res.status(400).json({
        message: 'Your location is unknown. Allow location access and try again, or call the local emergency number (112 in India).',
        code: 'LOCATION_UNKNOWN',
      });
    }

    // 3. Nearest police station (fast indexed query; optional)
    const nearest = await Station.findOne({ type: 'police', location: { $nearSphere: { $geometry: { type: 'Point', coordinates }, $maxDistance: 20000 } } })
      .select('_id')
      .lean()
      .catch(() => null);

    // 4. Save the incident with its first history entry
    const message = str(body.message, 300);
    const accuracy = Number.isFinite(body.accuracy) && body.accuracy >= 0 ? body.accuracy : locationSource === 'last_known' ? user.lastAccuracy : undefined;
    const incident = await Incident.create({
      touristId: userId,
      type: 'SOS',
      message,
      location: { type: 'Point', coordinates },
      locationSource,
      locationAccuracy: accuracy ?? undefined,
      nearestStation: nearest?._id,
      history: [{ status: 'Reported', by: userId, note: 'SOS button pressed' }],
    });
    await SosLock.updateOne({ _id: userId }, { incidentId: incident._id });

    // 5. Notify operators + the tourist immediately (in-app, over Socket.IO)
    await sendAlert({
      kind: 'SOS',
      severity: 'critical',
      title: 'SOS EMERGENCY',
      message: `${user.name} pressed SOS${message ? `: "${message}"` : ''}${locationSource === 'last_known' ? ' (last known location)' : ''}`,
      touristMessage: 'SOS sent. The control room has your location.',
      touristId: userId,
      touristName: user.name,
      incidentId: incident._id,
      lat: coordinates[1],
      lng: coordinates[0],
    });
    const views = await broadcastIncident(incident._id);
    res.status(201).json({ incident: views.touristView });

    // 6. Everything slow happens after the response: blockchain proof, email/SMS, address lookup
    queueProof(incident._id);
    notifyEvent('SOS', user, { incidentId: incident._id, message, lat: coordinates[1], lng: coordinates[0] }).catch(() => {});
    audit(req, 'SOS_CREATE', { targetType: 'Incident', targetId: incident._id });
    reverseGeocode(coordinates[1], coordinates[0])
      .then(async (address) => {
        if (!address) return;
        await Incident.updateOne({ _id: incident._id }, { address });
        await broadcastIncident(incident._id);
      })
      .catch(() => {}); // the address is a convenience only
  } catch (err) {
    await SosLock.deleteOne({ _id: userId, incidentId: null }).catch(() => {});
    throw err; // handled by the central error handler
  }
});

// GET /api/incidents?status=&type=&q=&from=&to=&page=&limit=
// Operators see all incidents, a tourist only their own.
router.get('/', requireAuth, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const { page, limit, skip } = pagination(req.query, 100, 500);
  const filter = isAdmin ? {} : { touristId: req.user.id };
  const status = String(req.query.status || '');
  if (status === 'Open') filter.status = { $ne: 'Resolved' };
  else if (Incident.STATUSES.includes(status)) filter.status = status;
  if (['SOS', 'ZONE_ALERT', 'ANOMALY'].includes(req.query.type)) filter.type = req.query.type;
  const range = dateRange(req.query);
  if (range) filter.createdAt = range;
  if (isAdmin && req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
    const touristIds = await User.find({ role: 'tourist', $or: [{ name: rx }, { email: rx }] }).distinct('_id');
    filter.$or = [{ touristId: { $in: touristIds } }, { message: rx }, { assignedTo: rx }, { address: rx }];
    if (isObjectId(String(req.query.q))) filter.$or.push({ _id: String(req.query.q) });
  }
  const [incidents, total] = await Promise.all([
    Incident.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(isAdmin ? POPULATE_ADMIN : POPULATE_TOURIST).lean(),
    Incident.countDocuments(filter),
  ]);
  res.json({ incidents: isAdmin ? incidents : incidents.map(forTourist), total, page, limit });
});

// GET /api/incidents/:id  (operator, or the tourist who raised it)
router.get('/:id', requireAuth, async (req, res) => {
  if (!isObjectId(req.params.id)) throw httpError(400, 'Invalid incident id');
  const isAdmin = req.user.role === 'admin';
  const filter = isAdmin ? { _id: req.params.id } : { _id: req.params.id, touristId: req.user.id };
  const incident = await Incident.findOne(filter).populate(isAdmin ? POPULATE_ADMIN : POPULATE_TOURIST).lean();
  if (!incident) return res.status(404).json({ message: 'Incident not found' }); // also for other tourists' incidents (no IDOR hints)
  if (!isAdmin) return res.json({ incident: forTourist(incident) });
  const proofs = await ChainProof.find({ kind: 'INCIDENT', refId: incident._id }).sort({ createdAt: 1 }).lean();
  res.json({ incident, proofs });
});

// PATCH /api/incidents/:id/status  body: { status, assignedTo, note, resolution, revision }  (operators only)
router.patch('/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  if (!isObjectId(req.params.id)) throw httpError(400, 'Invalid incident id');
  const { status, assignedTo, note, resolution, revision } = req.body || {};
  const incident = await Incident.findById(req.params.id);
  if (!incident) return res.status(404).json({ message: 'Incident not found' });

  // Enforce the workflow order
  const allowed = NEXT_STATUS[incident.status];
  if (!allowed.includes(status)) {
    return res.status(400).json({
      message: `Cannot change status from ${incident.status} to ${status}. Allowed next: ${allowed.join(' or ') || 'none (already resolved)'}`,
      code: 'INVALID_TRANSITION',
    });
  }
  if (revision !== undefined && revision !== incident.revision) {
    return res.status(409).json({ message: 'This incident was changed by someone else. Reload and try again.', code: 'STALE_REVISION' });
  }
  const officer = str(assignedTo, 100);
  if (status === 'Assigned' && !officer) return res.status(400).json({ message: 'Enter the officer or unit being assigned' });
  const resolutionValue = status === 'Resolved' ? (Incident.RESOLUTIONS.includes(resolution) ? resolution : 'resolved') : undefined;
  if (status === 'Resolved' && resolution === 'cancelled_by_tourist') return res.status(400).json({ message: 'Only the tourist can cancel their own SOS' });

  const changes = { status };
  if (status === 'Assigned') changes.assignedTo = officer;
  if (resolutionValue) changes.resolution = resolutionValue;
  const historyEntry = { status, by: req.user.id, note: str(note, 500) || undefined, at: new Date() };

  // Atomic update that only matches if status AND revision are still what we read above.
  // If two operators click at the same moment, the second one gets a 409 instead of a double update.
  const updated = await Incident.findOneAndUpdate(
    { _id: incident._id, status: incident.status, revision: incident.revision },
    { $set: changes, $push: { history: historyEntry }, $inc: { revision: 1 } },
    { new: true }
  );
  if (!updated) return res.status(409).json({ message: 'Someone else updated this incident first. Please check again.', code: 'CONFLICT' });

  const tourist = await User.findById(updated.touristId).lean();
  if (status === 'Assigned') {
    await notifyTourist(updated.touristId, 'Help is assigned', `${officer} is handling your emergency.`, 'INCIDENT_UPDATE', { incidentId: updated._id });
    if (tourist) notifyEvent('INCIDENT_ASSIGNED', tourist, { incidentId: updated._id, assignedTo: officer }).catch(() => {});
  } else {
    await notifyTourist(updated.touristId, 'Incident resolved', 'Your incident has been marked as resolved. Stay safe!', 'INCIDENT_UPDATE', { incidentId: updated._id });
    if (tourist) notifyEvent('INCIDENT_STATUS', tourist, { incidentId: updated._id, status, note: historyEntry.note }).catch(() => {});
  }
  await audit(req, status === 'Assigned' ? 'INCIDENT_ASSIGN' : 'INCIDENT_RESOLVE', { targetType: 'Incident', targetId: updated._id, details: { assignedTo: changes.assignedTo, resolution: resolutionValue } });
  queueProof(updated._id); // every new state gets its own hash on chain
  const views = await broadcastIncident(updated._id);
  res.json({ incident: views.adminView });
});

// POST /api/incidents/:id/notes  body: { text, revision }  (operators only)
router.post('/:id/notes', requireAuth, requireRole('admin'), async (req, res) => {
  if (!isObjectId(req.params.id)) throw httpError(400, 'Invalid incident id');
  const text = str(req.body?.text, 1000);
  if (!text) return res.status(400).json({ message: 'Note text is required' });
  const filter = { _id: req.params.id };
  if (req.body?.revision !== undefined) filter.revision = req.body.revision;
  const updated = await Incident.findOneAndUpdate(filter, { $push: { notes: { text, by: req.user.id, at: new Date() } }, $inc: { revision: 1 } }, { new: true });
  if (!updated) {
    const exists = await Incident.exists({ _id: req.params.id });
    return exists
      ? res.status(409).json({ message: 'This incident was changed by someone else. Reload and try again.', code: 'STALE_REVISION' })
      : res.status(404).json({ message: 'Incident not found' });
  }
  await audit(req, 'INCIDENT_NOTE', { targetType: 'Incident', targetId: updated._id });
  queueProof(updated._id);
  const views = await broadcastIncident(updated._id);
  res.status(201).json({ incident: views.adminView });
});

// POST /api/incidents/:id/cancel  body: { reason }  -> the tourist withdraws their own SOS (only while still Reported)
router.post('/:id/cancel', requireAuth, requireRole('tourist'), async (req, res) => {
  if (!isObjectId(req.params.id)) throw httpError(400, 'Invalid incident id');
  const reason = str(req.body?.reason, 300) || 'Cancelled by tourist';
  const updated = await Incident.findOneAndUpdate(
    { _id: req.params.id, touristId: req.user.id, status: 'Reported' },
    {
      $set: { status: 'Resolved', resolution: 'cancelled_by_tourist' },
      $push: { history: { status: 'Resolved', by: req.user.id, note: `Cancelled by tourist: ${reason}`, at: new Date() } },
      $inc: { revision: 1 },
    },
    { new: true }
  );
  if (!updated) {
    const own = await Incident.findOne({ _id: req.params.id, touristId: req.user.id }).lean();
    if (!own) return res.status(404).json({ message: 'Incident not found' });
    return res.status(409).json({ message: `This incident is already ${own.status} and can no longer be cancelled by you. Contact the control room.` });
  }
  await sendAlert({
    kind: 'INCIDENT_UPDATE',
    severity: 'medium',
    audience: 'operators',
    title: 'SOS cancelled by tourist',
    message: `${req.user.name} cancelled their SOS: ${reason}`,
    touristId: req.user.id,
    touristName: req.user.name,
    incidentId: updated._id,
  });
  await audit(req, 'INCIDENT_CANCEL', { targetType: 'Incident', targetId: updated._id });
  queueProof(updated._id);
  const views = await broadcastIncident(updated._id);
  res.json({ incident: views.touristView });
});

module.exports = router;
