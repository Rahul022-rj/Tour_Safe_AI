// First-time setup, shared by "npm run setup" and AUTO_SETUP=true on server start.
// Only ADDS what is missing; never touches real users unless reset is requested (development only).
const bcrypt = require('bcryptjs');
const config = require('../config');
const User = require('../models/User');
const Zone = require('../models/Zone');
const Station = require('../models/Station');
const { isEmail, passwordProblems } = require('../utils/validate');

const MODEL_NAMES = ['User', 'Zone', 'Station', 'Location', 'Incident', 'Alert', 'Notification', 'AuditLog', 'ChainProof', 'SosLock', 'RiskModel', 'SafetyCheckIn', 'Journey', 'Broadcast'];

// Demo city: Hyderabad. Coordinates are approximate. GeoJSON uses [longitude, latitude].
function rect(minLng, minLat, maxLng, maxLat) {
  return { type: 'Polygon', coordinates: [[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]] };
}
const SOURCE = 'Initial setup (sample classification, review and adjust in the Zone manager)';
const ZONES = [
  { name: 'Hussain Sagar & Tank Bund', type: 'green', description: 'Patrolled tourist area', geometry: rect(78.465, 17.415, 78.48, 17.43) },
  { name: 'Birla Mandir & Lumbini Park', type: 'green', description: 'Safe, well-lit public area', geometry: rect(78.466, 17.404, 78.476, 17.412) },
  { name: 'Charminar Market', type: 'yellow', description: 'Very crowded, pickpocket risk', geometry: rect(78.471, 17.3585, 78.479, 17.365) },
  { name: 'Golconda Fort Outer Ruins', type: 'yellow', description: 'Isolated paths, poor lighting after dark', geometry: rect(78.398, 17.38, 78.406, 17.387) },
  { name: 'Musi Riverbed', type: 'red', description: 'Restricted: flood risk', geometry: rect(78.483, 17.369, 78.495, 17.3715) },
  { name: 'Restricted Defence Area', type: 'red', description: 'No entry for civilians', geometry: rect(78.39, 17.39, 78.398, 17.396) },
];
const point = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });
const STATIONS = [
  { name: 'Charminar Police Station', type: 'police', phone: '100', address: 'Charminar, Hyderabad', location: point(78.4735, 17.3622) },
  { name: 'Golconda Police Station', type: 'police', phone: '100', address: 'Golconda, Hyderabad', location: point(78.404, 17.389) },
  { name: 'Saifabad Police Station', type: 'police', phone: '100', address: 'Saifabad, Hyderabad', location: point(78.4665, 17.4005) },
  { name: 'Lake Police Station', type: 'police', phone: '100', address: 'Tank Bund, Hyderabad', location: point(78.4745, 17.4185) },
  { name: 'Osmania General Hospital', type: 'hospital', phone: '108', address: 'Afzal Gunj, Hyderabad', location: point(78.4747, 17.3725) },
  { name: 'Gandhi Hospital', type: 'hospital', phone: '108', address: 'Secunderabad', location: point(78.503, 17.425) },
  { name: 'Nampally Area Hospital', type: 'hospital', phone: '108', address: 'Nampally, Hyderabad', location: point(78.466, 17.393) },
];

async function runSetup({ reset = false, adminEmail, adminPassword, adminName, log = console.log, warn = console.warn } = {}) {
  const models = MODEL_NAMES.map((n) => require(`../models/${n}`));
  if (reset) {
    if (config.isProduction) throw new Error('reset is not allowed when NODE_ENV=production');
    await Promise.all(models.map((M) => M.deleteMany({})));
    log('[setup] All data deleted (--reset)');
  }
  // Indexes (2dsphere, TTL retention, unique) must exist before the app writes data
  await Promise.all(models.map((M) => M.syncIndexes()));

  if ((await Zone.estimatedDocumentCount()) === 0) {
    await Zone.insertMany(ZONES.map((z) => ({ ...z, source: SOURCE })));
    log(`[setup] ${ZONES.length} safety zones created`);
  } else log('[setup] Zones already exist: unchanged');

  if ((await Station.countDocuments({ source: 'demo-seed' })) === 0) {
    await Station.insertMany(STATIONS.map((s) => ({ ...s, source: 'demo-seed', verified: false })));
    log(`[setup] ${STATIONS.length} sample police/hospital records created (shown as DEMO; live data comes from OpenStreetMap)`);
  } else log('[setup] Sample stations already exist: unchanged');

  const existing = await User.findOne({ role: 'admin' }).lean();
  if (existing) {
    log(`[setup] Operator account already exists (${existing.email}): unchanged`);
  } else {
    const email = String(adminEmail || process.env.SETUP_ADMIN_EMAIL || (config.isProduction ? '' : 'admin@demo.com')).toLowerCase();
    const password = adminPassword || process.env.SETUP_ADMIN_PASSWORD || (config.isProduction ? '' : 'Admin@123');
    const name = adminName || process.env.SETUP_ADMIN_NAME || 'Control Room Operator';
    if (!isEmail(email)) throw new Error('No operator account yet: set SETUP_ADMIN_EMAIL (or --admin-email)');
    const problems = passwordProblems(password);
    if (problems.length) throw new Error(`SETUP_ADMIN_PASSWORD needs ${problems.join(', ')}`);
    await User.create({ name, email, role: 'admin', passwordHash: await bcrypt.hash(password, config.bcryptRounds), passwordChangedAt: new Date() });
    log(`[setup] Operator account created: ${email}`);
    if (email === 'admin@demo.com') warn('[setup] WARNING: this is the public development login. Change its password in Settings.');
  }
  const tourists = await User.countDocuments({ role: 'tourist' });
  log(`[setup] Done. ${tourists} registered tourist(s).`);
}

module.exports = { runSetup };
