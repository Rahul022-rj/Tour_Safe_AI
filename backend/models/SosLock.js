// Duplicate-SOS protection that works across several backend instances: one document per tourist,
// acquired atomically in MongoDB. The TTL index removes old locks automatically.
const mongoose = require('mongoose');

const sosLockSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // the tourist
  until: { type: Date, required: true }, // no new SOS before this time
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident' },
  createdAt: { type: Date, default: Date.now, expires: 3600 },
});

module.exports = mongoose.model('SosLock', sosLockSchema);
