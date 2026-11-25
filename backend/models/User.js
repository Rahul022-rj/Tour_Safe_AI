// User = a Tourist or an Operator/Admin (one collection, told apart by "role").
const mongoose = require('mongoose');

// Tourist-only fields use this so admins can be saved without them
const requiredForTourist = function () {
  return this.role === 'tourist';
};

const CHAIN_STATES = ['not_submitted', 'pending', 'confirmed', 'failed'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // bcrypt hash, never the plain password. select:false = not returned by queries unless asked for.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['tourist', 'admin'], default: 'tourist' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    phone: { type: String, trim: true, maxlength: 20 },
    // Bumped on password change/reset and suspension: every older JWT stops working
    tokenVersion: { type: Number, default: 0 },
    passwordChangedAt: Date,
    lastLoginAt: Date,
    // SHA-256 of the single-use reset token (the token itself is only ever in the email)
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },

    // ----- Tourist details (kept off-chain, in MongoDB only) -----
    govtIdType: { type: String, enum: ['passport', 'aadhaar', 'national_id', 'driving_licence', 'other'], default: 'passport' },
    govtId: { type: String, trim: true, required: requiredForTourist, maxlength: 40 }, // passport / Aadhaar number
    nationality: { type: String, trim: true, required: requiredForTourist, maxlength: 60 },
    tripStart: { type: Date, required: requiredForTourist },
    tripEnd: {
      type: Date,
      required: requiredForTourist,
      validate: {
        validator: function (value) {
          return !this.tripStart || value > this.tripStart;
        },
        message: 'Trip end date must be after trip start date',
      },
    },
    emergencyContact: {
      name: { type: String, trim: true, maxlength: 100 },
      phone: { type: String, trim: true, maxlength: 20 },
      email: { type: String, trim: true, lowercase: true, maxlength: 254 },
      relation: { type: String, trim: true, maxlength: 40 },
    },
    notificationPrefs: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      notifyEmergencyContact: { type: Boolean, default: true },
    },

    // ----- Digital ID -----
    salt: { type: String, select: false }, // random per tourist, needed to recompute the hash
    idHash: { type: String, unique: true, sparse: true }, // "0x..." SHA-256, the same value is stored on chain
    idChainStatus: { type: String, enum: CHAIN_STATES, default: 'not_submitted' },
    idTxHash: String, // blockchain transaction that registered the ID
    idRevokedAt: Date, // copy of the on-chain revocation, so chain:sync can restore it after a node reset
    idRevokeReason: { type: String, trim: true, maxlength: 300 },
    idRevokeTxHash: String,

    // ----- Live tracking state (history is in the Location collection) -----
    lastLocation: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number], default: undefined }, // [longitude, latitude]
    },
    lastAccuracy: Number, // metres, as reported by the browser
    lastSource: { type: String, enum: ['gps'] },
    lastSeenAt: Date,
    trackingActive: { type: Boolean, default: false }, // tourist pressed "Start tracking" and has not stopped
    trackingStartedAt: Date,
    // Zone at the last CONFIDENT update. Compared with the new zone to alert only on a CHANGE.
    lastZoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone', default: null },
    lastZoneType: { type: String, enum: ['red', 'yellow', 'green', 'none'], default: 'none' },
    lastZoneEnteredAt: Date,
    // Anomaly-detector working state
    anomaly: {
      jumpStreak: { type: Number, default: 0 },
      inactivityFlaggedAt: Date,
      dwellFlaggedAt: Date,
    },
  },
  { timestamps: true } // adds createdAt and updatedAt
);

userSchema.index({ role: 1, name: 1 });
userSchema.index({ role: 1, lastSeenAt: -1 });

// Never send secrets to the client, even if they were selected
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    delete ret.salt;
    delete ret.resetTokenHash;
    delete ret.resetTokenExpires;
    delete ret.tokenVersion;
    delete ret.anomaly;
    delete ret.__v;
    return ret;
  },
});

userSchema.statics.CHAIN_STATES = CHAIN_STATES;

module.exports = mongoose.model('User', userSchema);
