// Safety check-in timer ("check on me in 30 minutes"). If the tourist does not confirm before dueAt,
// the safety sweeper marks it missed, alerts the control room and notifies the emergency contact.
const mongoose = require('mongoose');

const checkInSchema = new mongoose.Schema(
  {
    touristId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    minutes: { type: Number, required: true, min: 5, max: 720 },
    note: { type: String, trim: true, maxlength: 200 }, // e.g. "Hiking to Golconda Fort"
    dueAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'completed', 'missed', 'cancelled'], default: 'active' },
    completedAt: Date,
    missedAt: Date,
    lastLocation: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number], default: undefined } },
  },
  { timestamps: true }
);

checkInSchema.index({ status: 1, dueAt: 1 });
checkInSchema.index({ touristId: 1, createdAt: -1 });
// At most one active check-in per tourist (enforced by the database, not just the code)
checkInSchema.index({ touristId: 1 }, { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_per_tourist' });

module.exports = mongoose.model('SafetyCheckIn', checkInSchema);
