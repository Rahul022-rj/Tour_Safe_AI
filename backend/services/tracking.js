// Location pipeline: every reading from a tourist's device goes through recordLocation().
// Steps: throttle -> classify zone (with confidence) -> save -> alert on confident zone change -> anomaly check -> push.
const config = require('../config');
const Location = require('../models/Location');
const User = require('../models/User');
const { emitToAdmins, emitToUser } = require('../socket');
const { classify, shouldAlert, getZones } = require('./geofence');
const { zoneEntryAlert } = require('./alerts');
const anomaly = require('./anomaly');
const { httpError } = require('../utils/http');

async function recordLocation(userId, { lat, lng, accuracy, speed, heading, source }) {
  const now = new Date();
  // Atomic throttle + read of the PREVIOUS state: only succeeds if the last update is older than the minimum interval.
  // Two requests at the same moment cannot both pass, even on different backend instances.
  const minGap = new Date(now - config.minLocationIntervalMs);
  const user = await User.findOneAndUpdate(
    { _id: userId, role: 'tourist', $or: [{ lastSeenAt: null }, { lastSeenAt: { $lte: minGap } }] },
    { $set: { lastSeenAt: now } },
    { new: false } // return the document as it was BEFORE this update
  ).lean();
  if (!user) {
    const exists = await User.exists({ _id: userId });
    if (!exists) return null;
    throw httpError(429, `Location updates are limited to one every ${config.minLocationIntervalMs / 1000}s`, { code: 'LOCATION_THROTTLED' });
  }

  const point = { type: 'Point', coordinates: [lng, lat] }; // GeoJSON order is [lng, lat]
  const acc = Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : undefined;

  // 1. Geo-fence check with Turf.js, aware of the reading's accuracy
  const { zone, confidence } = classify([lng, lat], await getZones(), acc);
  const zoneId = zone ? zone._id : null;
  const zoneType = zone ? zone.type : 'none';

  // 2. Save current state. The "last zone" only changes on a confident reading, so a noisy fix near a
  //    boundary cannot make the tourist flicker in and out of a zone (and trigger repeated alerts).
  const set = { lastLocation: point, lastAccuracy: acc ?? null, lastSource: source, lastSeenAt: now, trackingActive: true };
  if (!user.trackingActive) set.trackingStartedAt = now;
  if (confidence === 'high') {
    set.lastZoneId = zoneId;
    set.lastZoneType = zoneType;
    if (String(zoneId) !== String(user.lastZoneId)) set.lastZoneEnteredAt = now;
  }
  await User.updateOne({ _id: userId }, { $set: set });
  await Location.create({ userId, location: point, accuracy: acc, speed, heading, source, timestamp: now, zoneId, zoneType, zoneConfidence: confidence });

  // 3. Alert only on a CONFIDENT change into a red/yellow zone, not on every update
  let alert = null;
  if (shouldAlert(user.lastZoneId, zone, confidence)) alert = await zoneEntryAlert(user, zone, lat, lng, acc);

  // 4. Abnormal-movement check against the previous reading
  const prev = user.lastLocation?.coordinates?.length === 2
    ? { lat: user.lastLocation.coordinates[1], lng: user.lastLocation.coordinates[0], at: user.lastSeenAt, accuracy: user.lastAccuracy }
    : null;
  anomaly.checkReading(user, prev, { lat, lng, at: now, accuracy: acc }).catch((err) => console.warn(`[anomaly] ${err.message}`));
  // 4b. Planned-journey monitoring (off-route, arrival); awaited so the response can report it
  let journey = null;
  try {
    journey = await require('./safety').checkJourney(user, { lat, lng, accuracy: acc });
  } catch (err) {
    console.warn(`[safety] journey check failed: ${err.message}`);
  }

  // 5. Push the update to operator dashboards and to the tourist's own page
  const update = {
    userId: String(user._id),
    name: user.name,
    lat,
    lng,
    accuracy: acc ?? null,
    source,
    timestamp: now,
    zoneId: zoneId ? String(zoneId) : null,
    zoneName: zone ? zone.name : null,
    zoneType,
    zoneConfidence: confidence,
    trackingActive: true,
  };
  emitToAdmins('location:update', update);
  emitToUser(update.userId, 'location:self', update);

  return { ...update, alert, journey };
}

// Tourist pressed Start/Stop tracking
async function setTracking(userId, active) {
  const user = await User.findOneAndUpdate(
    { _id: userId },
    active ? { trackingActive: true, trackingStartedAt: new Date() } : { trackingActive: false, 'anomaly.inactivityFlaggedAt': null },
    { new: true }
  ).lean();
  if (user) emitToAdmins('tourist:status', { userId: String(userId), trackingActive: active });
  return user;
}

module.exports = { recordLocation, setTracking };
