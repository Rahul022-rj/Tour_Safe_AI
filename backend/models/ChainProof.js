// One blockchain write and its lifecycle: pending -> confirmed | failed (failed ones are retried by the chain worker).
//   ID_REGISTER  hash = Digital ID hash         ref = User
//   ID_REVOKE    hash = Digital ID hash         ref = User
//   INCIDENT     hash = incident state hash     ref = Incident
const mongoose = require('mongoose');

const chainProofSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['ID_REGISTER', 'ID_REVOKE', 'INCIDENT'], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true },
    hash: { type: String, required: true, match: /^0x[0-9a-f]{64}$/ },
    status: { type: String, enum: ['pending', 'submitted', 'confirmed', 'failed'], default: 'pending' },
    txHash: String,
    blockNumber: Number,
    chainId: Number,
    contractAddress: String,
    attempts: { type: Number, default: 0 },
    lastError: String,
    confirmedAt: Date,
    revision: Number, // incident revision this hash belongs to
  },
  { timestamps: true }
);

chainProofSchema.index({ kind: 1, hash: 1 }, { unique: true });
chainProofSchema.index({ refId: 1, createdAt: -1 });
chainProofSchema.index({ status: 1, updatedAt: 1 });

module.exports = mongoose.model('ChainProof', chainProofSchema);
