// EXPERIMENTAL risk prediction (decision tree, CART, implemented here so it needs no Python service).
//
// Prediction target: "an SOS incident is reported inside this ~1 km grid cell during this 3-hour window",
//                    for cell-windows in which at least one tourist was present (location history).
// Features (all known BEFORE the window starts, to avoid data leakage):
//   zoneLevel      0 none, 1 green, 2 yellow, 3 red (zone at the cell centre, rule-based geofence data)
//   hourBucket     0-7  (3-hour buckets of the local server time)
//   dayOfWeek      0-6
//   weekend        0/1
//   priorIncidents SOS incidents in the same cell strictly before the window
//   prior30d       SOS incidents in the same cell in the 30 days before the window
// Evaluation: time-based split (oldest 70% train, newest 30% test), never random, so the test period is
//             strictly in the future of the training data. Metrics: precision, recall, F1, confusion matrix.
// Data source: this deployment's own MongoDB (Location + Incident collections). No external dataset is bundled,
//              so until real incidents accumulate the model honestly reports "insufficient data".
// The model is advisory only. Geofencing alerts and SOS handling never depend on it.
const Location = require('../models/Location');
const Incident = require('../models/Incident');
const RiskModel = require('../models/RiskModel');
const { findZone, getZones, ZONE_PRIORITY } = require('./geofence');

const CELL_DEG = 0.01; // ~1.1 km of latitude
const WINDOW_H = 3;
const FEATURES = ['zoneLevel', 'hourBucket', 'dayOfWeek', 'weekend', 'priorIncidents', 'prior30d'];
const MIN = { samples: 40, trainPositives: 5, testPositives: 2 };
const PARAMS = { maxDepth: 4, minLeaf: 5 };
const LIMITATIONS = [
  'Experimental model trained only on incidents recorded by this TourSafe deployment.',
  'Few incidents means low reliability; probabilities are rough indications, not facts.',
  'It knows nothing about weather, events or crime statistics unless they are recorded as incidents.',
  'Never use it as the only basis for an emergency decision; geofence alerts and SOS work independently of it.',
];

const cellOf = (lat, lng) => `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`;
const cellCentre = (cell) => {
  const [a, b] = cell.split(':').map(Number);
  return [(b + 0.5) * CELL_DEG, (a + 0.5) * CELL_DEG]; // [lng, lat]
};
const windowStart = (date) => {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  d.setHours(Math.floor(d.getHours() / WINDOW_H) * WINDOW_H);
  return d;
};

function zoneLevelAt(lngLat, zones) {
  const z = findZone(lngLat, zones);
  return z ? ZONE_PRIORITY[z.type] : 0;
}

// Pure: feature vector for a cell at a window start, given incidents (sorted by time) in that cell
function features(cell, start, zones, cellIncidentTimes) {
  const before = cellIncidentTimes.filter((t) => t < start.getTime());
  const day = start.getDay();
  return {
    zoneLevel: zoneLevelAt(cellCentre(cell), zones),
    hourBucket: Math.floor(start.getHours() / WINDOW_H),
    dayOfWeek: day,
    weekend: day === 0 || day === 6 ? 1 : 0,
    priorIncidents: before.length,
    prior30d: before.filter((t) => t >= start.getTime() - 30 * 864e5).length,
  };
}

// Pure: build labelled samples from presence windows + incidents
function buildDataset(presence, incidents, zones) {
  const byCell = new Map();
  for (const inc of incidents) {
    const [lng, lat] = inc.location.coordinates;
    const c = cellOf(lat, lng);
    if (!byCell.has(c)) byCell.set(c, []);
    byCell.get(c).push(new Date(inc.createdAt).getTime());
  }
  const positives = new Set(
    incidents.map((inc) => {
      const [lng, lat] = inc.location.coordinates;
      return `${cellOf(lat, lng)}|${windowStart(inc.createdAt).getTime()}`;
    })
  );
  // A window with an incident counts as "present" even if no location sample landed in it
  const windows = new Set(presence.map((p) => `${p.cell}|${p.start.getTime()}`));
  for (const k of positives) windows.add(k);

  return [...windows]
    .map((k) => {
      const [cell, ts] = k.split('|');
      const start = new Date(Number(ts));
      return { cell, start, x: features(cell, start, zones, byCell.get(cell) || []), y: positives.has(k) ? 1 : 0 };
    })
    .sort((a, b) => a.start - b.start);
}

// ---------- CART decision tree (gini, class-weighted) ----------
function gini(pos, neg) {
  const n = pos + neg;
  if (!n) return 0;
  const p = pos / n;
  return 1 - p * p - (1 - p) * (1 - p);
}

function buildTree(rows, depth, params, w) {
  const pos = rows.reduce((s, r) => s + (r.y ? w[1] : 0), 0);
  const neg = rows.reduce((s, r) => s + (r.y ? 0 : w[0]), 0);
  const leaf = { leaf: true, n: rows.length, positives: rows.filter((r) => r.y).length, p: (pos + 1) / (pos + neg + 2) };
  if (depth >= params.maxDepth || rows.length < params.minLeaf * 2 || pos === 0 || neg === 0) return leaf;

  let best = null;
  const parentImpurity = gini(pos, neg);
  for (const f of FEATURES) {
    const values = [...new Set(rows.map((r) => r.x[f]))].sort((a, b) => a - b);
    for (let i = 0; i < values.length - 1; i++) {
      const threshold = (values[i] + values[i + 1]) / 2;
      const left = rows.filter((r) => r.x[f] <= threshold);
      const right = rows.filter((r) => r.x[f] > threshold);
      if (left.length < params.minLeaf || right.length < params.minLeaf) continue;
      const wsum = (rs) => [rs.reduce((s, r) => s + (r.y ? w[1] : 0), 0), rs.reduce((s, r) => s + (r.y ? 0 : w[0]), 0)];
      const [lp, ln] = wsum(left);
      const [rp, rn] = wsum(right);
      const impurity = ((lp + ln) * gini(lp, ln) + (rp + rn) * gini(rp, rn)) / (pos + neg);
      if (!best || impurity < best.impurity) best = { f, threshold, impurity, left, right };
    }
  }
  if (!best || best.impurity >= parentImpurity - 1e-9) return leaf;
  return {
    leaf: false,
    feature: best.f,
    threshold: best.threshold,
    n: rows.length,
    left: buildTree(best.left, depth + 1, params, w),
    right: buildTree(best.right, depth + 1, params, w),
  };
}

function trainTree(rows, params = PARAMS) {
  const positives = rows.filter((r) => r.y).length;
  const negatives = rows.length - positives;
  // Balanced class weights: rare positives count as much as the many negatives in total
  const w = { 1: positives ? rows.length / (2 * positives) : 1, 0: negatives ? rows.length / (2 * negatives) : 1 };
  return buildTree(rows, 0, params, w);
}

function predictTree(tree, x) {
  let node = tree;
  while (!node.leaf) node = x[node.feature] <= node.threshold ? node.left : node.right;
  return node;
}

function evaluate(tree, rows, threshold = 0.5) {
  const cm = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const r of rows) {
    const pred = predictTree(tree, r.x).p >= threshold ? 1 : 0;
    if (pred && r.y) cm.tp++;
    else if (pred && !r.y) cm.fp++;
    else if (!pred && r.y) cm.fn++;
    else cm.tn++;
  }
  const precision = cm.tp + cm.fp ? cm.tp / (cm.tp + cm.fp) : null;
  const recall = cm.tp + cm.fn ? cm.tp / (cm.tp + cm.fn) : null;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : precision === null || recall === null ? null : 0;
  return { confusionMatrix: cm, precision, recall, f1, threshold, testSize: rows.length };
}

// Reads presence windows from the location history (aggregated in MongoDB)
async function loadPresence() {
  const rows = await Location.aggregate([
    {
      $group: {
        _id: {
          cy: { $floor: { $divide: [{ $arrayElemAt: ['$location.coordinates', 1] }, CELL_DEG] } },
          cx: { $floor: { $divide: [{ $arrayElemAt: ['$location.coordinates', 0] }, CELL_DEG] } },
          // 30-minute UTC bins, regrouped into LOCAL 3-hour windows below (works for half-hour time zones like IST)
          w: { $dateTrunc: { date: '$timestamp', unit: 'minute', binSize: 30 } },
        },
      },
    },
    { $limit: 200000 },
  ]);
  const seen = new Map();
  for (const r of rows) {
    const p = { cell: `${r._id.cy}:${r._id.cx}`, start: windowStart(r._id.w) };
    seen.set(`${p.cell}|${p.start.getTime()}`, p);
  }
  return [...seen.values()];
}

async function train(userId) {
  const zones = await getZones();
  const [presence, incidents] = await Promise.all([loadPresence(), Incident.find({ type: 'SOS' }).select('location createdAt').lean()]);
  const rows = buildDataset(presence, incidents, zones);
  const cut = Math.floor(rows.length * 0.7);
  const trainRows = rows.slice(0, cut);
  const testRows = rows.slice(cut);
  const dataset = {
    sources: ['MongoDB Location collection (presence windows)', 'MongoDB Incident collection (SOS reports)'],
    samples: rows.length,
    positives: rows.filter((r) => r.y).length,
    train: { size: trainRows.length, positives: trainRows.filter((r) => r.y).length, from: trainRows[0]?.start, to: trainRows.at(-1)?.start },
    test: { size: testRows.length, positives: testRows.filter((r) => r.y).length, from: testRows[0]?.start, to: testRows.at(-1)?.start },
    split: 'time-based 70/30 (test period strictly after training period)',
  };
  const last = await RiskModel.findOne().sort({ version: -1 }).lean();
  const version = (last?.version || 0) + 1;
  const base = { version, target: 'SOS incident in ~1 km cell within a 3-hour window', features: FEATURES, params: PARAMS, dataset, trainedBy: userId };

  const enough = rows.length >= MIN.samples && dataset.train.positives >= MIN.trainPositives && dataset.test.positives >= MIN.testPositives;
  if (!enough) {
    const doc = await RiskModel.create({
      ...base,
      status: 'insufficient_data',
      active: false,
      metrics: { reason: `Need at least ${MIN.samples} samples, ${MIN.trainPositives} positive training and ${MIN.testPositives} positive test samples.` },
    });
    return doc.toObject();
  }
  const tree = trainTree(trainRows);
  const metrics = evaluate(tree, testRows);
  await RiskModel.updateMany({ active: true }, { active: false });
  const doc = await RiskModel.create({ ...base, tree, metrics, status: 'experimental', active: true });
  return doc.toObject();
}

// Simple transparent baseline used when no trained model exists (clearly labelled, not ML)
function baseline(x) {
  const score = Math.min(1, 0.1 + x.zoneLevel * 0.2 - (x.zoneLevel === 1 ? 0.15 : 0) + Math.min(x.prior30d, 5) * 0.08 + (x.hourBucket >= 7 || x.hourBucket <= 1 ? 0.1 : 0));
  return Math.max(0, Math.round(score * 100) / 100);
}

async function predict({ lat, lng, at = new Date() }) {
  const zones = await getZones();
  const cell = cellOf(lat, lng);
  const start = windowStart(at);
  const [cy, cx] = cell.split(':').map(Number);
  const incidents = await Incident.find({
    type: 'SOS',
    createdAt: { $lt: start },
    'location.coordinates.1': { $gte: cy * CELL_DEG, $lt: (cy + 1) * CELL_DEG },
    'location.coordinates.0': { $gte: cx * CELL_DEG, $lt: (cx + 1) * CELL_DEG },
  })
    .select('createdAt')
    .lean();
  const x = features(cell, start, zones, incidents.map((i) => new Date(i.createdAt).getTime()));
  // The actual zone at the exact point (not the cell centre) is reported separately for context
  const exactZone = findZone([lng, lat], zones);
  const model = await RiskModel.findOne({ active: true }).sort({ version: -1 }).lean();

  const common = { features: x, zoneAtPoint: exactZone ? { name: exactZone.name, type: exactZone.type } : null, limitations: LIMITATIONS, window: { start, hours: WINDOW_H } };
  if (!model) {
    return {
      ...common,
      method: 'baseline-heuristic',
      modelAvailable: false,
      score: baseline(x),
      level: null,
      message: 'No trained model yet (insufficient incident data). Showing a simple rule-based indication, not a machine-learning prediction.',
    };
  }
  const leaf = predictTree(model.tree, x);
  const p = Math.round(leaf.p * 100) / 100;
  return {
    ...common,
    method: model.algorithm,
    modelAvailable: true,
    modelVersion: model.version,
    status: model.status,
    score: p,
    level: p >= 0.6 ? 'high' : p >= 0.3 ? 'medium' : 'low',
    confidence: { leafSamples: leaf.n, leafPositives: leaf.positives, note: leaf.n < 20 ? 'Few similar past samples: low confidence' : 'Based on similar past samples' },
    metrics: model.metrics,
  };
}

module.exports = { FEATURES, LIMITATIONS, cellOf, windowStart, features, buildDataset, trainTree, predictTree, evaluate, train, predict, baseline };
