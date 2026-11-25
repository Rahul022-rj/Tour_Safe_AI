// In-app alert (zone entry, SOS, anomaly, incident update, ID status). Saved so that a dashboard opened
// later, a second backend instance, or the tourist's notification page all see the same history.
const mongoose = require('mongoose');

const KINDS = ['ZONE_ENTRY', 'SOS', 'ANOMALY', 'INCIDENT_UPDATE', 'ID_REVOKED', 'ID_STATUS', 'INFO', 'CHECKIN_MISSED', 'BROADCAST', 'JOURNEY'];

const alertSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: KINDS, required: true },
    severity: { type: String, enum: ['critical', 'high', 'medium', 'review', 'warning', 'info'], default: 'info' },
    title: { type: String, required: true },
    message: String, // shown to operators
    touristMessage: String, // shown to the tourist concerned
    touristId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    touristName: String,
    audience: { type: String, enum: ['all', 'operators', 'tourist'], default: 'all' },
    zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
    zoneName: String,
    zoneType: String,
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident' },
    lat: Number,
    lng: Number,
    details: mongoose.Schema.Types.Mixed, // supporting evidence, e.g. for anomaly alerts
    readByTourist: { type: Boolean, default: false },
    reviewedAt: Date, // operator acknowledged (anomaly review)
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

alertSchema.index({ createdAt: -1 });
alertSchema.index({ touristId: 1, createdAt: -1 });
alertSchema.index({ kind: 1, createdAt: -1 });

alertSchema.statics.KINDS = KINDS;

module.exports = mongoose.model('Alert', alertSchema);
