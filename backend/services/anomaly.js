// Abnormal-movement detection. Produces OPERATOR-REVIEW alerts only: it never marks a tourist as "in danger".
//
// Rules (all thresholds configurable, see config.js):
//  1. Implausible movement: implied speed between two consecutive accurate readings > ANOMALY_MAX_SPEED_KMH.
//     One jump is normal GPS noise, so an alert needs JUMP_STREAK consecutive implausible readings.
//  2. Signal lost: tracking was switched on but no update for ANOMALY_INACTIVITY_MIN minutes
//     (could be a flat battery, no network, or the browser tab being suspended - the alert says so).
//  3. Prolonged restricted-zone stay: confidently inside a red zone for ANOMALY_RESTRICTED_DWELL_MIN minutes.
const turf = require('@turf/turf');
const config = require('../config');
const User = require('../models/User');
const { sendAlert } = require('./alerts');

const JUMP_STREAK = 2;
const GOOD_ACCURACY_M = 50; // readings worse than this are too noisy to judge speed

// Pure: implied speed in km/h between two readings { lat, lng, at, accuracy }
function impliedSpeedKmh(a, b) {
  const seconds = (new Date(b.at) - new Date(a.at)) / 1000;
  if (seconds <= 0) return null;
  const km = turf.distance([a.lng, a.lat], [b.lng, b.lat], { units: 'kilometers' });
  return (km / seconds) * 3600;
}

// Pure: is this pair of readings an implausible jump?
function isImplausibleJump(prev, next, maxKmh = config.anomalyMaxSpeedKmh) {
  if (!prev) return false;
  const noisy = (r) => Number.isFinite(r.accuracy) && r.accuracy > GOOD_ACCURACY_M;
  if (noisy(prev) || noisy(next)) return false;
  const speed = impliedSpeedKmh(prev, next);
  return speed !== null && speed > maxKmh;
}

// Called by the tracking pipeline for every reading. prev = the user's previous saved state.
async function checkReading(user, prev, next) {
  const jump = isImplausibleJump(prev, next);
  const streak = jump ? (user.anomaly?.jumpStreak || 0) + 1 : 0;
  if (streak !== (user.anomaly?.jumpStreak || 0)) await User.updateOne({ _id: user._id }, { 'anomaly.jumpStreak': streak });
  if (jump && streak === JUMP_STREAK) {
    return sendAlert({
      kind: 'ANOMALY',
      severity: 'review',
      audience: 'operators',
      title: 'Unusual movement (review)',
      message: `${user.name}: ${streak} consecutive location jumps faster than ${config.anomalyMaxSpeedKmh} km/h. Possibly GPS error or device change; please review.`,
      touristId: user._id,
      touristName: user.name,
      lat: next.lat,
      lng: next.lng,
      details: { rule: 'IMPLAUSIBLE_SPEED', speedKmh: Math.round(impliedSpeedKmh(prev, next)), from: prev, to: next, threshold: config.anomalyMaxSpeedKmh },
    });
  }
  return null;
}

// Periodic sweep for the time-based rules
async function sweep(now = new Date()) {
  const created = [];
  const inactiveBefore = new Date(now - config.anomalyInactivityMin * 60000);
  const lost = await User.find({
    role: 'tourist',
    trackingActive: true,
    lastSeenAt: { $lt: inactiveBefore },
    $or: [{ 'anomaly.inactivityFlaggedAt': null }, { 'anomaly.inactivityFlaggedAt': { $lt: inactiveBefore } }],
  }).lean();
  for (const u of lost) {
    // Atomic claim: only one instance raises the alert
    const claimed = await User.updateOne({ _id: u._id, 'anomaly.inactivityFlaggedAt': u.anomaly?.inactivityFlaggedAt ?? null }, { 'anomaly.inactivityFlaggedAt': now });
    if (!claimed.modifiedCount) continue;
    const minutes = Math.round((now - new Date(u.lastSeenAt)) / 60000);
    created.push(
      await sendAlert({
        kind: 'ANOMALY',
        severity: 'review',
        audience: 'operators',
        title: 'Location updates stopped (review)',
        message: `${u.name} has tracking switched on but no location for ${minutes} min. Causes include battery, network or a suspended browser tab.`,
        touristId: u._id,
        touristName: u.name,
        lat: u.lastLocation?.coordinates?.[1],
        lng: u.lastLocation?.coordinates?.[0],
        details: { rule: 'SIGNAL_LOST', lastSeenAt: u.lastSeenAt, minutes, threshold: config.anomalyInactivityMin },
      })
    );
  }

  const dwellSince = new Date(now - config.anomalyRestrictedDwellMin * 60000);
  const dwelling = await User.find({
    role: 'tourist',
    lastZoneType: 'red',
    lastZoneEnteredAt: { $lt: dwellSince },
    lastSeenAt: { $gte: new Date(now - config.staleAfterMs * 2) },
    $or: [{ 'anomaly.dwellFlaggedAt': null }, { $expr: { $lt: ['$anomaly.dwellFlaggedAt', '$lastZoneEnteredAt'] } }],
  }).lean();
  for (const u of dwelling) {
    const claimed = await User.updateOne({ _id: u._id, lastZoneEnteredAt: u.lastZoneEnteredAt, 'anomaly.dwellFlaggedAt': u.anomaly?.dwellFlaggedAt ?? null }, { 'anomaly.dwellFlaggedAt': now });
    if (!claimed.modifiedCount) continue;
    const minutes = Math.round((now - new Date(u.lastZoneEnteredAt)) / 60000);
    created.push(
      await sendAlert({
        kind: 'ANOMALY',
        severity: 'review',
        audience: 'operators',
        title: 'Prolonged stay in restricted zone (review)',
        message: `${u.name} has been inside a restricted zone for ${minutes} min.`,
        touristId: u._id,
        touristName: u.name,
        zoneId: u.lastZoneId,
        lat: u.lastLocation?.coordinates?.[1],
        lng: u.lastLocation?.coordinates?.[0],
        details: { rule: 'RESTRICTED_DWELL', enteredAt: u.lastZoneEnteredAt, minutes, threshold: config.anomalyRestrictedDwellMin },
      })
    );
  }
  return created;
}

let timer = null;
function startSweeper() {
  if (timer) return;
  timer = setInterval(() => sweep().catch((err) => console.warn(`[anomaly] sweep failed: ${err.message}`)), config.anomalySweepMs);
  timer.unref();
}
function stopSweeper() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { impliedSpeedKmh, isImplausibleJump, checkReading, sweep, startSweeper, stopSweeper };
