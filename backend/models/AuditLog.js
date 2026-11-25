// Who did what, when. Written for every security-relevant or operator action. Never contains secrets.
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole: String,
    action: { type: String, required: true }, // e.g. ZONE_CREATE, INCIDENT_ASSIGN, ID_REVOKE, LOGIN_FAILED
    targetType: String,
    targetId: String,
    details: mongoose.Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
// Keep one year of audit history
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600, name: 'retention' });

module.exports = mongoose.model('AuditLog', auditLogSchema);
