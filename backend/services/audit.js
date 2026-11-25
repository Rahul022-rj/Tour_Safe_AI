// Audit logging. Failures to write the audit log are reported but never break the user's request.
const AuditLog = require('../models/AuditLog');

async function audit(req, action, { targetType, targetId, details } = {}) {
  try {
    await AuditLog.create({
      actorId: req?.user?.id,
      actorRole: req?.user?.role,
      action,
      targetType,
      targetId: targetId ? String(targetId) : undefined,
      details,
      ip: req?.ip,
    });
  } catch (err) {
    console.error(`[audit] could not record ${action}: ${err.message}`);
  }
}

module.exports = { audit };
