// Geo-fence zone drawn by the operator. Stored as a GeoJSON Polygon.
const mongoose = require('mongoose');

const zoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // red = restricted, yellow = caution, green = safe
    type: { type: String, enum: ['red', 'yellow', 'green'], required: true },
    description: { type: String, trim: true, maxlength: 500 },
    geometry: {
      type: { type: String, enum: ['Polygon'], default: 'Polygon' },
      // GeoJSON order is [longitude, latitude]. The first and last point must be the same (closed ring).
      coordinates: { type: [[[Number]]], required: true },
    },
    // Where the risk classification came from and when it was last reviewed (shown next to routes)
    source: { type: String, trim: true, maxlength: 200, default: 'Operator-defined' },
    reviewedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Lets MongoDB validate the polygon and run geo queries. The point-in-zone check itself uses Turf.js.
zoneSchema.index({ geometry: '2dsphere' });

module.exports = mongoose.model('Zone', zoneSchema);
