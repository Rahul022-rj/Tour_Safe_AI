// Central configuration. Every other file reads settings from here, never from process.env directly.
// New variable names are preferred; the old names (MONGO_URI, CHAIN_RPC_URL) still work.
const path = require('path');

// Node 20.12+ can load a .env file by itself, so we do not need the "dotenv" package.
// Tests set TOURSAFE_SKIP_ENV_FILE=1 so a developer's .env cannot leak into them.
if (!process.env.TOURSAFE_SKIP_ENV_FILE) {
  try {
    process.loadEnvFile(path.join(__dirname, '.env'));
  } catch {
    console.warn('[config] backend/.env not found, using default values');
  }
}

const env = process.env;
const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));
const bool = (value, fallback = false) => (value === undefined || value === '' ? fallback : /^(1|true|yes)$/i.test(value));

const nodeEnv = env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const config = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: num(env.PORT, 5000),
  mongoUri: env.MONGODB_URI || env.MONGO_URI || 'mongodb://127.0.0.1:27017/tourist_safety',
  jwtSecret: env.JWT_SECRET || '',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
  // On Render the public URL is provided automatically as RENDER_EXTERNAL_URL
  clientUrl: (env.CLIENT_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, ''),
  // Extra allowed browser origins (comma separated), e.g. a LAN address used to test on a phone
  extraOrigins: (env.CORS_EXTRA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: bool(env.TRUST_PROXY, false), // set to true behind nginx / a load balancer so rate limits see the real IP
  bcryptRounds: num(env.BCRYPT_ROUNDS, 12),
  passwordResetMinutes: num(env.PASSWORD_RESET_MINUTES, 30),

  // ----- Hosting helpers -----
  autoSetup: bool(env.AUTO_SETUP, false), // run the first-time setup on every start (creates only what is missing)
  embeddedChain: bool(env.EMBEDDED_CHAIN, false), // start a demo Hardhat chain inside the server (see services/embeddedChain.js)
  embeddedChainPort: num(env.EMBEDDED_CHAIN_PORT, 8545),

  // ----- Blockchain -----
  chainRpcUrl: env.BLOCKCHAIN_RPC_URL || env.CHAIN_RPC_URL || 'http://127.0.0.1:8545',
  chainId: num(env.CHAIN_ID, 31337),
  contractAddress: env.CONTRACT_ADDRESS || '', // empty = read it from blockchain/deployment.json
  privateKey: env.PRIVATE_KEY || '', // empty = use the Hardhat node's unlocked account #0 (local dev chain only)
  chainConfirmations: num(env.CHAIN_CONFIRMATIONS, 1),
  chainTxTimeoutMs: num(env.CHAIN_TX_TIMEOUT_MS, 60000),
  chainRetryIntervalMs: num(env.CHAIN_RETRY_INTERVAL_MS, 30000),
  chainMaxAttempts: num(env.CHAIN_MAX_ATTEMPTS, 10),
  // true = a Digital ID is only VALID after its on-chain registration is confirmed
  requireChainForId: bool(env.REQUIRE_CHAIN_FOR_ID, true),
  deploymentFile: env.DEPLOYMENT_FILE || path.join(__dirname, '..', 'blockchain', 'deployment.json'),

  // ----- Tracking / geofencing -----
  locationRetentionDays: num(env.LOCATION_RETENTION_DAYS, 30),
  minLocationIntervalMs: num(env.MIN_LOCATION_INTERVAL_MS, 2000), // server-side throttle per tourist
  geofenceMaxAccuracyM: num(env.GEOFENCE_MAX_ACCURACY_M, 100), // readings worse than this never raise zone alerts
  staleAfterMs: num(env.STALE_AFTER_MS, 60000),
  offlineAfterMs: num(env.OFFLINE_AFTER_MS, 10 * 60000),
  sosCooldownMs: num(env.SOS_COOLDOWN_MS, 30000),

  // ----- Anomaly detection -----
  anomalyMaxSpeedKmh: num(env.ANOMALY_MAX_SPEED_KMH, 200),
  anomalyInactivityMin: num(env.ANOMALY_INACTIVITY_MIN, 30),
  anomalyRestrictedDwellMin: num(env.ANOMALY_RESTRICTED_DWELL_MIN, 10),
  anomalySweepMs: num(env.ANOMALY_SWEEP_MS, 60000),

  // ----- Safety tools -----
  routeDeviationM: num(env.ROUTE_DEVIATION_M, 150), // further than this from the planned route counts as off-route
  routeDeviationReadings: num(env.ROUTE_DEVIATION_READINGS, 3), // consecutive off-route readings before an alert
  arrivalRadiusM: num(env.ARRIVAL_RADIUS_M, 60),
  journeyOverdueGraceMin: num(env.JOURNEY_OVERDUE_GRACE_MIN, 15),
  safetySweepMs: num(env.SAFETY_SWEEP_MS, 30000),

  // ----- External services (all optional) -----
  smtp: {
    host: env.SMTP_HOST || '',
    port: num(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.EMAIL_FROM || '',
  },
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    from: env.TWILIO_FROM_NUMBER || '',
  },
  notifyCooldownMs: num(env.NOTIFY_COOLDOWN_MS, 10 * 60000), // same alert kind to the same contact at most once per window
  osrmUrl: (env.OSRM_URL || 'https://routing.openstreetmap.de').replace(/\/$/, ''),
  nominatimUrl: (env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, ''),
  overpassUrls: (env.OVERPASS_URLS || 'https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter')
    .split(',').map((s) => s.trim()).filter(Boolean),
  externalUserAgent: env.EXTERNAL_USER_AGENT || 'TourSafe-AI/1.0 (tourist safety research project)',
  disableExternalApis: bool(env.DISABLE_EXTERNAL_APIS, false), // tests and offline demos
};

if (config.embeddedChain) {
  // The embedded chain is always a local Hardhat chain on 127.0.0.1
  config.chainRpcUrl = `http://127.0.0.1:${config.embeddedChainPort}`;
  config.chainId = 31337;
  config.contractAddress = '';
  config.privateKey = '';
}

config.allowedOrigins = [config.clientUrl, ...config.extraOrigins];
config.emailConfigured = Boolean(config.smtp.host && config.smtp.from);
config.smsConfigured = Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.from);

// Fail fast on settings that would make the server insecure or broken
function validateConfig() {
  const problems = [];
  if (!config.jwtSecret) {
    if (config.isProduction) problems.push('JWT_SECRET is required in production');
    else {
      config.jwtSecret = 'dev-only-insecure-secret';
      console.warn('[config] JWT_SECRET not set: using an insecure development secret');
    }
  } else if (config.isProduction && config.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters in production');
  }
  if (config.isProduction && config.chainId !== 31337 && !config.privateKey) {
    problems.push('PRIVATE_KEY is required for a non-Hardhat blockchain network');
  }
  if (config.privateKey && !/^0x[0-9a-fA-F]{64}$/.test(config.privateKey)) {
    problems.push('PRIVATE_KEY must be 0x followed by 64 hex characters');
  }
  if (!/^mongodb(\+srv)?:\/\//.test(config.mongoUri)) problems.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  if (!Number.isFinite(config.port)) problems.push('PORT must be a number');
  if (problems.length) {
    const err = new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
    err.code = 'CONFIG_INVALID';
    throw err;
  }
  return config;
}

config.validateConfig = validateConfig;
module.exports = config;
