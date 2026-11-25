// In-app alerts: saved in MongoDB (so history survives restarts and is shared by all instances) and pushed
// over Socket.IO. Alerts are notifications; incidents are the records that are worked on.
const Alert = require('../models/Alert');
const { emitToAdmins, emitToUser } = require('../socket');
const { notifyEvent } = require('./notify');

// Shape sent to browsers (id = Mongo _id as a string, timestamp = createdAt)
const toPayload = (doc) => {
  const a = doc.toObject ? doc.toObject() : doc;
  return { ...a, id: String(a._id), timestamp: a.createdAt, touristId: a.touristId ? String(a.touristId) : undefined };
};

// Every kind of alert goes through here. audience: all | operators | tourist
async function sendAlert(alert) {
  const doc = await Alert.create({ audience: 'all', ...alert });
  const payload = toPayload(doc);
  if (payload.audience !== 'tourist') emitToAdmins('alert', payload);
  if (payload.touristId && payload.audience !== 'operators') emitToUser(payload.touristId, 'alert', payload);
  return payload;
}

async function zoneEntryAlert(user, zone, lat, lng, accuracy) {
  const restricted = zone.type === 'red';
  const alert = await sendAlert({
    kind: 'ZONE_ENTRY',
    severity: restricted ? 'high' : 'medium',
    title: restricted ? 'Restricted zone entered' : 'Caution zone entered',
    message: `${user.name} entered ${restricted ? 'RESTRICTED' : 'caution'} zone "${zone.name}"`,
    touristMessage: restricted
      ? `You entered a restricted area: ${zone.name}. Please leave immediately.`
      : `Caution: ${zone.name}. ${zone.description || 'Stay alert.'}`,
    touristId: user._id,
    touristName: user.name,
    zoneId: zone._id,
    zoneName: zone.name,
    zoneType: zone.type,
    lat,
    lng,
    details: accuracy !== undefined ? { accuracy } : undefined,
  });
  // Email/SMS in the background: a slow provider must never delay location processing
  notifyEvent(restricted ? 'ZONE_RED' : 'ZONE_YELLOW', user, { zoneId: zone._id, zoneName: zone.name, description: zone.description, lat, lng }).catch(() => {});
  return alert;
}

// A personal notification for one tourist only (e.g. "help assigned"); saved for their notification page
function notifyTourist(touristId, title, message, kind = 'INFO', extra = {}) {
  return sendAlert({ kind, severity: 'info', title, message, touristMessage: message, touristId, audience: 'tourist', ...extra });
}

// Recent alerts for operators (newest first)
async function getRecentAlerts(limit = 50) {
  const docs = await Alert.find({ audience: { $ne: 'tourist' } }).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map(toPayload);
}

module.exports = { sendAlert, zoneEntryAlert, notifyTourist, getRecentAlerts, toPayload };
