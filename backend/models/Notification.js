// One outbound notification attempt (email or SMS). "sent" is only stored when the provider accepted it.
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ['email', 'sms'], required: true },
    recipientType: { type: String, enum: ['tourist', 'emergency_contact', 'operator'], required: true },
    to: { type: String, required: true }, // stored masked, e.g. "+91******4321"
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // tourist the notification is about
    event: { type: String, required: true }, // SOS, ZONE_RED, ZONE_YELLOW, INCIDENT_ASSIGNED, INCIDENT_STATUS, PASSWORD_RESET
    subject: String,
    status: { type: String, enum: ['sent', 'failed', 'not_configured', 'skipped'], required: true },
    provider: String,
    providerMessageId: String,
    error: String,
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident' },
    dedupeKey: String, // used to avoid sending the same alert again within NOTIFY_COOLDOWN_MS
  },
  { timestamps: true }
);

notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
