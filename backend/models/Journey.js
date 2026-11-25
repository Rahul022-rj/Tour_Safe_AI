// A planned journey: the tourist chose a route in the safe-route planner and pressed "Start journey".
// While it is active, every location reading is compared with the route (deviation), the destination
// (arrival) and the expected arrival time (overdue).
const mongoose = require('mongoose');

const journeySchema = new mongoose.Schema(
  {
    touristId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['active', 'arrived', 'cancelled', 'overdue'], default: 'active' },
    mode: { type: String, enum: ['foot', 'car', 'bike'], default: 'foot' },
    destinationName: { type: String, trim: true, maxlength: 200 },
    destination: { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], required: true } }, // [lng, lat]
    route: { type: { type: String, enum: ['LineString'], default: 'LineString' }, coordinates: { type: [[Number]], required: true } },
    distanceM: Number,
    expectedDurationS: Number,
    expectedArrivalAt: Date,
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
    // Deviation tracking state
    offRouteStreak: { type: Number, default: 0 },
    lastDistanceFromRouteM: Number,
    deviationAlertedAt: Date,
    overdueAlertedAt: Date,
  },
  { timestamps: true }
);

journeySchema.index({ touristId: 1 }, { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_journey' });
journeySchema.index({ status: 1, expectedArrivalAt: 1 });

module.exports = mongoose.model('Journey', journeySchema);
