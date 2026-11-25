// Safety advisory sent by an operator to all tourists or to tourists inside one zone.
const mongoose = require('mongoose');

const broadcastSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
    target: { type: String, enum: ['all', 'zone'], default: 'all' },
    zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
    zoneName: String,
    recipients: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

broadcastSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Broadcast', broadcastSchema);
