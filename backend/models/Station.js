// Police station or hospital. Stored as a GeoJSON Point so we can find the nearest one with $near.
// Records come from two sources and are always labelled so the UI never presents demo data as verified:
//   demo-seed      -> sample records created by the seed script (NOT verified emergency facilities)
//   openstreetmap  -> cached from the OpenStreetMap Overpass API (community data, not officially verified)
const mongoose = require('mongoose');

const stationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['police', 'hospital'], required: true },
  phone: { type: String, trim: true },
  address: { type: String, trim: true },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  source: { type: String, enum: ['demo-seed', 'openstreetmap'], default: 'demo-seed' },
  sourceId: { type: String }, // e.g. "node/123456" for OpenStreetMap
  verified: { type: Boolean, default: false }, // only true if an operator confirmed the record
  fetchedAt: Date,
});

// $near only works when this 2dsphere index exists
stationSchema.index({ location: '2dsphere' });
stationSchema.index({ source: 1, sourceId: 1 }, { unique: true, partialFilterExpression: { sourceId: { $type: 'string' } } });

module.exports = mongoose.model('Station', stationSchema);
