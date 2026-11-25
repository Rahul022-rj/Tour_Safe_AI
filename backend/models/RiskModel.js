// A trained, versioned risk-prediction model (experimental). The tree itself is stored as JSON.
const mongoose = require('mongoose');

const riskModelSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true, unique: true },
    algorithm: { type: String, default: 'decision-tree-cart' },
    target: String,
    features: [String],
    params: mongoose.Schema.Types.Mixed,
    tree: mongoose.Schema.Types.Mixed,
    dataset: mongoose.Schema.Types.Mixed, // sizes, date range, class balance, data sources
    metrics: mongoose.Schema.Types.Mixed, // precision, recall, f1, confusion matrix on the held-out (later) period
    status: { type: String, enum: ['experimental', 'insufficient_data'], default: 'experimental' },
    active: { type: Boolean, default: false },
    trainedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RiskModel', riskModelSchema);
