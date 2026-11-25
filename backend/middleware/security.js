// Security middleware: MongoDB operator sanitization and rate limiters.
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');

// Removes keys that start with "$" or contain "." from user input, recursively, so a body like
// {"email": {"$gt": ""}} can never become a MongoDB query operator.
// (express-mongo-sanitize does not work with Express 5, where req.query is a read-only getter.)
function stripOperators(value, depth = 0) {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripOperators(v, depth + 1));
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) delete value[key];
    else value[key] = stripOperators(value[key], depth + 1);
  }
  return value;
}

function sanitizeInput(req, res, next) {
  if (req.body && typeof req.body === 'object') stripOperators(req.body);
  if (req.params) stripOperators(req.params);
  // Express 5: req.query is a getter computed per access, so we replace it with a sanitized copy
  const q = stripOperators({ ...req.query });
  Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true, enumerable: true });
  next();
}

// Rate limiters (memory store: correct for one instance; use a shared store such as Redis when scaling out)
const json429 = (message) => (req, res) => res.status(429).json({ message, code: 'RATE_LIMITED' });
const skip = () => config.isTest && !process.env.TEST_RATE_LIMITS;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed logins count
  skip,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip || '')}|${String(req.body?.email || '').toLowerCase()}`,
  handler: json429('Too many failed login attempts. Try again in 15 minutes.'),
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  handler: json429('Too many password reset requests. Try again later.'),
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  handler: json429('Too many registrations from this address. Try again later.'),
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  handler: json429('Too many requests. Slow down.'),
});

// External lookups (routing, geocoding, places) are proxied to free public services with strict usage policies
const externalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip || ''),
  handler: json429('Too many map lookups. Wait a minute and try again.'),
});

module.exports = { sanitizeInput, stripOperators, loginLimiter, passwordResetLimiter, registerLimiter, apiLimiter, externalLimiter };
