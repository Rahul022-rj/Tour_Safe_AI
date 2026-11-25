// Builds the Express application (no network listening here, so tests can use it directly with supertest).
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const config = require('./config');
const { sanitizeInput, apiLimiter } = require('./middleware/security');

function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security headers. The CSP allows the OpenStreetMap tiles and data: QR images used by the React app.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.fr'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          mediaSrc: ["'self'", 'blob:'],
          workerSrc: ["'self'", 'blob:'],
        },
      },
      crossOriginEmbedderPolicy: false,
      // OpenStreetMap's tile servers reject requests without a Referer (tile usage policy). Send only the
      // site's origin to other sites, never full page URLs (Helmet's default 'no-referrer' breaks the map).
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.allowedOrigins.includes(origin)),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    })
  );
  // Parse JSON request bodies into req.body (zone polygons are the largest legitimate bodies)
  app.use(express.json({ limit: '200kb' }));
  app.use(sanitizeInput);
  app.use('/api', apiLimiter);

  // ---------- Routes ----------
  app.get('/api/health', async (req, res) => {
    const db = mongoose.connection.readyState === 1;
    let chain = { ok: false };
    try {
      const s = await require('./services/blockchain').getChainStatus();
      chain = { ok: true, chainId: s.chainId, blockNumber: s.blockNumber };
    } catch (err) {
      chain = { ok: false, error: err.message };
    }
    const setup = config.autoSetup ? require('./services/setup').getSetupStatus() : undefined;
    res.status(db ? 200 : 503).json({ ok: db, database: db ? 'connected' : 'disconnected', blockchain: chain, setup, time: new Date() });
  });
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/tourists', require('./routes/tourist'));
  app.use('/api/zones', require('./routes/zones'));
  app.use('/api/incidents', require('./routes/incidents'));
  app.use('/api/verify', require('./routes/verify'));
  app.use('/api/geo', require('./routes/geo'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/safety', require('./routes/safety'));

  app.use('/api', (req, res) => res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` }));

  // Production: serve the built React app from frontend/dist (single origin, no CORS needed)
  const dist = path.join(__dirname, '..', 'frontend', 'dist');
  if (config.isProduction && fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api|socket\.io).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((req, res) => res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` }));

  // Central error handler. In Express 5, errors thrown inside async route handlers arrive here automatically.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request body too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed JSON body' });
    if (err.name === 'ValidationError') {
      const errors = Object.fromEntries(Object.entries(err.errors || {}).map(([k, v]) => [k, v.message]));
      return res.status(400).json({ message: 'Please correct the highlighted fields', errors }); // Mongoose schema validation failed
    }
    if (err.name === 'CastError') return res.status(400).json({ message: `Invalid ${err.path}` }); // e.g. a malformed id in the URL
    if (err.code === 16755) return res.status(400).json({ message: 'Invalid zone shape: the edges must not cross each other' }); // 2dsphere index
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue || {})[0] || 'value';
      return res.status(409).json({ message: `${field} already exists` }); // unique index violated
    }
    if (err.name === 'MongoServerSelectionError' || err.name === 'MongoNetworkError' || /buffering timed out/.test(err.message)) {
      console.error(`[db] ${req.method} ${req.originalUrl}: ${err.message}`);
      return res.status(503).json({ message: 'Database unavailable. Please try again shortly.', code: 'DB_UNAVAILABLE' });
    }
    if (err.status && err.status < 500) {
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    if (err.status && err.expose) {
      console.warn(`[error] ${req.method} ${req.originalUrl} -> ${err.status}: ${err.message}`); // expected, e.g. chain down
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    console.error(`[error] ${req.method} ${req.originalUrl}`, err); // unexpected bug: full stack trace in the server log only
    res.status(500).json({ message: config.isProduction ? 'Internal server error' : `Server error: ${err.message}` });
  });

  return app;
}

module.exports = { createApp };
