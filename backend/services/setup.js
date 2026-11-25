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

// Result of the last setup run, shown (without secrets) in /api/health
const lastResult = { ran: false, ok: null, message: null, at: null };
const getSetupStatus = () => ({ ...lastResult });

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

  // Values pasted into hosting dashboards often carry a trailing space or newline: trim them
  const email = String(adminEmail || process.env.SETUP_ADMIN_EMAIL || (config.isProduction ? '' : 'admin@demo.com')).trim().toLowerCase();
  const password = String(adminPassword || process.env.SETUP_ADMIN_PASSWORD || (config.isProduction ? '' : 'Admin@123')).trim();
  const name = String(adminName || process.env.SETUP_ADMIN_NAME || 'Control Room Operator').trim();
  const resetRequested = /^(1|true|yes)$/i.test(String(process.env.SETUP_ADMIN_RESET || '').trim());

  const validateCredentials = () => {
    if (!isEmail(email)) throw new Error('No valid SETUP_ADMIN_EMAIL (or --admin-email) given');
    const problems = passwordProblems(password);
    if (problems.length) throw new Error(`SETUP_ADMIN_PASSWORD needs ${problems.join(', ')}`);
  };

  if (resetRequested) {
    // Recovery: make SETUP_ADMIN_EMAIL an operator login with SETUP_ADMIN_PASSWORD (turn the flag off afterwards)
    validateCredentials();
    const user = await User.findOne({ email });
    if (user && user.role !== 'admin') throw new Error(`${email} is registered as a tourist; choose a different SETUP_ADMIN_EMAIL`);
    if (user) {
      user.passwordHash = await bcrypt.hash(password, config.bcryptRounds);
      user.passwordChangedAt = new Date();
      user.status = 'active';
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await user.save();
      log(`[setup] Operator password reset for ${email} (SETUP_ADMIN_RESET). Set SETUP_ADMIN_RESET=false now.`);
    } else {
      await User.create({ name, email, role: 'admin', passwordHash: await bcrypt.hash(password, config.bcryptRounds), passwordChangedAt: new Date() });
      log(`[setup] Operator account created: ${email} (SETUP_ADMIN_RESET)`);
    }
  } else {
    const existing = await User.findOne({ role: 'admin' }).lean();
    if (existing) {
      log(`[setup] Operator account already exists (${existing.email}): unchanged`);
    } else {
      validateCredentials();
      if (await User.exists({ email })) throw new Error(`${email} is already registered as a tourist; choose a different SETUP_ADMIN_EMAIL`);
      await User.create({ name, email, role: 'admin', passwordHash: await bcrypt.hash(password, config.bcryptRounds), passwordChangedAt: new Date() });
      log(`[setup] Operator account created: ${email}`);
      if (email === 'admin@demo.com') warn('[setup] WARNING: this is the public development login. Change its password in Settings.');
    }
  }
  const tourists = await User.countDocuments({ role: 'tourist' });
  log(`[setup] Done. ${tourists} registered tourist(s).`);
}

// Wrapper used on server start: records the outcome instead of throwing
async function runSetupOnStart() {
  lastResult.ran = true;
  lastResult.at = new Date();
  try {
    await runSetup();
    const User = require('../models/User');
    const operators = await User.countDocuments({ role: 'admin', status: 'active' });
    lastResult.ok = operators > 0;
    lastResult.message = operators > 0 ? `${operators} operator account(s)` : 'No operator account exists';
  } catch (err) {
    lastResult.ok = false;
    lastResult.message = err.message; // never contains passwords or connection strings
    console.error(`[setup] ${err.message}`);
  }
  return getSetupStatus();
}

module.exports = { runSetup, runSetupOnStart, getSetupStatus };
