// Safety tools:
//  1. Check-in timer: missed check-ins alert the control room and the emergency contact.
//  2. Journey monitoring: off-route (after N consecutive accurate readings), arrival, overdue.
//  3. Operator broadcasts to all tourists or to tourists inside one zone.
// Like the anomaly detector, deviation and overdue alerts are for OPERATOR REVIEW; they never declare an emergency.
const turf = require('@turf/turf');
const config = require('../config');
const SafetyCheckIn = require('../models/SafetyCheckIn');
const Journey = require('../models/Journey');
const Broadcast = require('../models/Broadcast');
const User = require('../models/User');
const Alert = require('../models/Alert');
const { sendAlert, notifyTourist, toPayload } = require('./alerts');
const { notifyEvent } = require('./notify');
const { classify, getZones } = require('./geofence');
const { emitToAdmins, emitToUser } = require('../socket');
const { httpError } = require('../utils/http');

const GOOD_ACCURACY_M = 100;

// ---------------- Check-ins ----------------
async function startCheckIn(touristId, { minutes, note }) {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720) throw httpError(400, 'minutes must be a whole number from 5 to 720');
  // Starting a new timer replaces the previous one
  await SafetyCheckIn.updateMany({ touristId, status: 'active' }, { status: 'cancelled' });
  const checkIn = await SafetyCheckIn.create({ touristId, minutes, note: String(note || '').trim().slice(0, 200) || undefined, dueAt: new Date(Date.now() + minutes * 60000) });
  emitToAdmins('checkin:update', checkIn.toObject());
  return checkIn.toObject();
}

async function endCheckIn(touristId, status) {
  const checkIn = await SafetyCheckIn.findOneAndUpdate(
    { touristId, status: 'active' },
    { status, ...(status === 'completed' && { completedAt: new Date() }) },
    { new: true }
  ).lean();
  if (!checkIn) throw httpError(404, 'No active check-in');
  emitToAdmins('checkin:update', checkIn);
  return checkIn;
}

// "I'm safe" also clears a recently MISSED check-in so the control room knows the tourist is fine
async function confirmSafe(touristId) {
  const active = await SafetyCheckIn.findOneAndUpdate({ touristId, status: 'active' }, { status: 'completed', completedAt: new Date() }, { new: true }).lean();
  if (active) {
    emitToAdmins('checkin:update', active);
    return active;
  }
  const missed = await SafetyCheckIn.findOneAndUpdate(
    { touristId, status: 'missed', missedAt: { $gte: new Date(Date.now() - 24 * 3600e3) } },
    { status: 'completed', completedAt: new Date() },
    { new: true, sort: { missedAt: -1 } }
  ).lean();
  if (!missed) throw httpError(404, 'No active or missed check-in');
  const user = await User.findById(touristId).lean();
  await sendAlert({
    kind: 'CHECKIN_MISSED',
    severity: 'info',
    audience: 'operators',
    title: 'Late check-in confirmed',
    message: `${user.name} confirmed they are safe after missing a check-in.`,
    touristId,
    touristName: user.name,
  });
  emitToAdmins('checkin:update', missed);
  return missed;
}

async function currentCheckIn(touristId) {
  return SafetyCheckIn.findOne({ touristId }).sort({ createdAt: -1 }).lean();
}

// ---------------- Journeys ----------------
async function startJourney(touristId, { route, destination, destinationName, mode, distanceM, durationS }) {
  if (route?.type !== 'LineString' || !Array.isArray(route.coordinates) || route.coordinates.length < 2 || route.coordinates.length > 20000) {
    throw httpError(400, 'route must be a GeoJSON LineString from the route planner');
  }
  const valid = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  if (!route.coordinates.every(valid)) throw httpError(400, 'route has invalid coordinates');
  const dest = destination && valid([destination.lng, destination.lat]) ? [destination.lng, destination.lat] : route.coordinates.at(-1);
  const seconds = Number.isFinite(durationS) && durationS > 0 ? Math.min(durationS, 24 * 3600) : null;
  await Journey.updateMany({ touristId, status: 'active' }, { status: 'cancelled', endedAt: new Date() });
  const journey = await Journey.create({
    touristId,
    mode: ['foot', 'car', 'bike'].includes(mode) ? mode : 'foot',
    destinationName: String(destinationName || '').slice(0, 200) || undefined,
    destination: { type: 'Point', coordinates: dest },
    route: { type: 'LineString', coordinates: route.coordinates.map((p) => [p[0], p[1]]) },
    distanceM: Number.isFinite(distanceM) ? Math.round(distanceM) : Math.round(turf.length(turf.lineString(route.coordinates), { units: 'meters' })),
    expectedDurationS: seconds,
    expectedArrivalAt: seconds ? new Date(Date.now() + seconds * 1000) : undefined,
  });
  emitToAdmins('journey:update', { ...journey.toObject(), route: undefined });
  return journey.toObject();
}

async function endJourney(touristId, status = 'cancelled') {
  const journey = await Journey.findOneAndUpdate({ touristId, status: { $in: ['active', 'overdue'] } }, { status, endedAt: new Date() }, { new: true }).lean();
  if (!journey) throw httpError(404, 'No active journey');
  emitToAdmins('journey:update', { ...journey, route: undefined });
  return journey;
}

const currentJourney = (touristId) => Journey.findOne({ touristId, status: { $in: ['active', 'overdue'] } }).lean();

// Pure: distance (m) from a point [lng, lat] to the planned route
function distanceFromRoute(point, route) {
  return turf.pointToLineDistance(turf.point(point), turf.lineString(route.coordinates), { units: 'meters' });
}

// Called by the tracking pipeline for every reading of a tourist
async function checkJourney(user, { lat, lng, accuracy }) {
  const journey = await Journey.findOne({ touristId: user._id, status: { $in: ['active', 'overdue'] } });
  if (!journey) return null;
  const point = [lng, lat];
  const toDest = turf.distance(point, journey.destination.coordinates, { units: 'meters' });

  // Arrived
  if (toDest <= Math.max(config.arrivalRadiusM, Number.isFinite(accuracy) ? Math.min(accuracy, 150) : 0)) {
    journey.status = 'arrived';
    journey.endedAt = new Date();
    await journey.save();
    await notifyTourist(user._id, 'You have arrived', `You reached ${journey.destinationName || 'your destination'}. Journey monitoring stopped.`, 'JOURNEY');
    emitToAdmins('journey:update', { ...journey.toObject(), route: undefined });
    return { event: 'arrived', toDestinationM: Math.round(toDest) };
  }

  const off = distanceFromRoute(point, journey.route);
  const reliable = !Number.isFinite(accuracy) || accuracy <= GOOD_ACCURACY_M;
  journey.lastDistanceFromRouteM = Math.round(off);
  let event = null;
  if (reliable && off > config.routeDeviationM + (Number.isFinite(accuracy) ? accuracy : 0)) {
    journey.offRouteStreak += 1;
    // One alert per deviation episode: only when the streak first reaches the threshold
    if (journey.offRouteStreak === config.routeDeviationReadings) {
      journey.deviationAlertedAt = new Date();
      event = 'deviation';
      await sendAlert({
        kind: 'ANOMALY',
        severity: 'review',
        audience: 'all',
        title: 'Off planned route (review)',
        message: `${user.name} is ${Math.round(off)} m away from their planned route to ${journey.destinationName || 'their destination'} (${journey.offRouteStreak} readings in a row).`,
        touristMessage: `You seem to have left your planned route (${Math.round(off)} m away). If this is intended, you can ignore this or end your journey.`,
        touristId: user._id,
        touristName: user.name,
        lat,
        lng,
        details: { rule: 'ROUTE_DEVIATION', distanceM: Math.round(off), threshold: config.routeDeviationM, readings: journey.offRouteStreak, journeyId: journey._id },
      });
    }
  } else if (reliable) {
    if (journey.offRouteStreak >= config.routeDeviationReadings) event = 'back_on_route';
    journey.offRouteStreak = 0;
  }
  await journey.save();
  emitToUser(String(user._id), 'journey:self', { ...journey.toObject(), route: undefined, toDestinationM: Math.round(toDest) });
  return { event, distanceFromRouteM: Math.round(off), toDestinationM: Math.round(toDest) };
}

// ---------------- Broadcasts ----------------
async function broadcast(operatorId, { title, message, severity = 'info', target = 'all', zoneId }) {
  title = String(title || '').trim().slice(0, 120);
  message = String(message || '').trim().slice(0, 1000);
  if (title.length < 3) throw httpError(400, 'Title is required');
  if (message.length < 3) throw httpError(400, 'Message is required');
  if (!['info', 'warning', 'critical'].includes(severity)) throw httpError(400, 'severity must be info, warning or critical');
  if (!['all', 'zone'].includes(target)) throw httpError(400, 'target must be all or zone');

  const tourists = await User.find({ role: 'tourist', status: 'active' }).select('name lastLocation lastAccuracy lastSeenAt').lean();
  let recipients = tourists;
  let zone = null;
  if (target === 'zone') {
    zone = (await getZones()).find((z) => String(z._id) === String(zoneId));
    if (!zone) throw httpError(400, 'Choose a valid zone');
    const since = Date.now() - config.offlineAfterMs * 6; // anyone seen there within the last hour
    // Recompute against the polygon itself (not just the stored zone id) so overlapping zones are handled
    recipients = tourists.filter((t) => {
      const c = t.lastLocation?.coordinates;
      if (!c || !t.lastSeenAt || new Date(t.lastSeenAt) < since) return false;
      return classify(c, [zone], undefined).zone !== null;
    });
  }
  const doc = await Broadcast.create({ title, message, severity, target, zoneId: zone?._id, zoneName: zone?.name, recipients: recipients.length, createdBy: operatorId });
  const alertSeverity = { info: 'info', warning: 'warning', critical: 'high' }[severity];
  if (recipients.length) {
    const alerts = await Alert.insertMany(
      recipients.map((t) => ({ kind: 'BROADCAST', severity: alertSeverity, audience: 'tourist', title, message, touristMessage: message, touristId: t._id, touristName: t.name, zoneId: zone?._id, zoneName: zone?.name, details: { broadcastId: doc._id } }))
    );
    for (const a of alerts) emitToUser(String(a.touristId), 'alert', toPayload(a));
  }
  emitToAdmins('broadcast', doc.toObject());
  return doc.toObject();
}

// ---------------- Sweeper (missed check-ins, overdue journeys) ----------------
async function sweep(now = new Date()) {
  const results = { missedCheckIns: 0, overdueJourneys: 0 };

  const due = await SafetyCheckIn.find({ status: 'active', dueAt: { $lte: now } }).limit(100).lean();
  for (const c of due) {
    // Atomic claim: only one instance raises the alert
    const claimed = await SafetyCheckIn.findOneAndUpdate({ _id: c._id, status: 'active' }, { status: 'missed', missedAt: now }, { new: true });
    if (!claimed) continue;
    const user = await User.findById(c.touristId).lean();
    if (!user) continue;
    const [lng, lat] = user.lastLocation?.coordinates || [];
    if (user.lastLocation?.coordinates) claimed.lastLocation = user.lastLocation;
    await claimed.save();
    await sendAlert({
      kind: 'CHECKIN_MISSED',
      severity: 'high',
      audience: 'all',
      title: 'Safety check-in missed',
      message: `${user.name} did not confirm their safety check-in (due ${new Date(c.dueAt).toLocaleTimeString()})${c.note ? `: "${c.note}"` : ''}. Try to contact them.`,
      touristMessage: 'You missed your safety check-in. Tap "I\'m safe" if you are fine, or press SOS if you need help.',
      touristId: user._id,
      touristName: user.name,
      lat,
      lng,
      details: { checkInId: c._id, dueAt: c.dueAt, minutes: c.minutes, note: c.note, lastSeenAt: user.lastSeenAt },
    });
    notifyEvent('CHECKIN_MISSED', user, { dueAt: c.dueAt, note: c.note, lat, lng }).catch(() => {});
    emitToAdmins('checkin:update', claimed.toObject());
    results.missedCheckIns++;
  }

  const graceMs = config.journeyOverdueGraceMin * 60000;
  const late = await Journey.find({ status: 'active', expectedArrivalAt: { $ne: null } }).limit(200).lean();
  for (const j of late) {
    // Overdue = expected arrival + max(grace, 50% of the planned duration) has passed
    const allowance = Math.max(graceMs, (j.expectedDurationS || 0) * 500);
    if (new Date(j.expectedArrivalAt).getTime() + allowance > now.getTime()) continue;
    const claimed = await Journey.findOneAndUpdate({ _id: j._id, status: 'active' }, { status: 'overdue', overdueAlertedAt: now }, { new: true });
    if (!claimed) continue;
    const user = await User.findById(j.touristId).lean();
    if (!user) continue;
    const [lng, lat] = user.lastLocation?.coordinates || [];
    await sendAlert({
      kind: 'JOURNEY',
      severity: 'review',
      audience: 'all',
      title: 'Journey overdue (review)',
      message: `${user.name} has not reached ${j.destinationName || 'their destination'} (expected ${new Date(j.expectedArrivalAt).toLocaleTimeString()}).`,
      touristMessage: 'You have not reached your destination yet. If you are fine, end your journey; if not, press SOS.',
      touristId: user._id,
      touristName: user.name,
      lat,
      lng,
      details: { rule: 'JOURNEY_OVERDUE', journeyId: j._id, expectedArrivalAt: j.expectedArrivalAt },
    });
    notifyEvent('JOURNEY_OVERDUE', user, { destinationName: j.destinationName, expectedArrivalAt: j.expectedArrivalAt, lat, lng }).catch(() => {});
    emitToAdmins('journey:update', { ...claimed.toObject(), route: undefined });
    results.overdueJourneys++;
  }
  return results;
}

let timer = null;
function startSweeper() {
  if (timer) return;
  timer = setInterval(() => sweep().catch((err) => console.warn(`[safety] sweep failed: ${err.message}`)), config.safetySweepMs);
  timer.unref();
}
function stopSweeper() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startCheckIn, endCheckIn, confirmSafe, currentCheckIn,
  startJourney, endJourney, currentJourney, checkJourney, distanceFromRoute,
  broadcast, sweep, startSweeper, stopSweeper,
};
