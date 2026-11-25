// One location reading from a tourist's own device (browser geolocation). Gives us the movement history.
const mongoose = require('mongoose');
const config = require('../config');

const locationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  accuracy: { type: Number, min: 0 }, // metres, as reported by the browser
  speed: Number, // m/s if the device reported it
  heading: Number,
  // Zone the tourist was inside at this moment (filled by the geo-fence service)
  zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone', default: null },
  zoneType: { type: String, enum: ['red', 'yellow', 'green', 'none'], default: 'none' },
  // high = accurate enough and clearly inside/outside; uncertain = accuracy circle crosses a zone boundary
  zoneConfidence: { type: String, enum: ['high', 'uncertain'], default: 'high' },
  source: { type: String, enum: ['gps'], default: 'gps' }, // only real device locations are accepted
  timestamp: { type: Date, default: Date.now },
});

// Fast lookup of "latest locations of this tourist"
locationSchema.index({ userId: 1, timestamp: -1 });
// Data retention: MongoDB deletes history points automatically after LOCATION_RETENTION_DAYS
locationSchema.index({ timestamp: 1 }, { expireAfterSeconds: config.locationRetentionDays * 24 * 3600 });

module.exports = mongoose.model('Location', locationSchema);
