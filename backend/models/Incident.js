// An incident (mainly SOS). Status flow: Reported -> Assigned -> Resolved.
const mongoose = require('mongoose');

const STATUSES = ['Reported', 'Assigned', 'Resolved'];
const RESOLUTIONS = ['resolved', 'false_alarm', 'cancelled_by_tourist'];

const incidentSchema = new mongoose.Schema(
  {
    touristId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['SOS', 'ZONE_ALERT', 'ANOMALY'], default: 'SOS' },
    message: { type: String, trim: true, maxlength: 500 },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [longitude, latitude]
    },
    locationSource: { type: String, enum: ['live', 'last_known'], default: 'live' },
    locationAccuracy: Number, // metres
    address: { type: String, trim: true }, // reverse-geocoded later, if the geocoder is reachable
    status: { type: String, enum: STATUSES, default: 'Reported' },
    resolution: { type: String, enum: RESOLUTIONS },
    assignedTo: { type: String, trim: true, maxlength: 100 }, // officer or unit name
    nearestStation: { type: mongoose.Schema.Types.ObjectId, ref: 'Station' },
    // Audit trail of every status change
    history: [
      {
        status: { type: String, enum: STATUSES },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: { type: String, maxlength: 500 },
        at: { type: Date, default: Date.now },
      },
    ],
    // Free-text operator notes (part of the hashed record, so a note change gets a new proof)
    notes: [
      {
        text: { type: String, required: true, maxlength: 1000 },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
      },
    ],
    // Optimistic concurrency: every change must send the revision it read; mismatches get 409
    revision: { type: Number, default: 0 },
    // Latest CONFIRMED blockchain proof (full history is in the ChainProof collection)
    chainHash: String,
    chainTxHash: String,
    chainLoggedAt: Date,
    // State of the most recent proof attempt
    chainStatus: { type: String, enum: ['not_submitted', 'pending', 'confirmed', 'failed'], default: 'not_submitted' },
  },
  { timestamps: true }
);

// Fast "my incidents, newest first" and "all open incidents" queries
incidentSchema.index({ touristId: 1, createdAt: -1 });
incidentSchema.index({ status: 1, createdAt: -1 });
incidentSchema.index({ createdAt: -1 });

incidentSchema.statics.STATUSES = STATUSES;
incidentSchema.statics.RESOLUTIONS = RESOLUTIONS;

module.exports = mongoose.model('Incident', incidentSchema);
