// Entry point of the backend: Express REST API + Socket.IO on one HTTP server.
const http = require('http');
const mongoose = require('mongoose');
const config = require('./config');

try {
  config.validateConfig();
} catch (err) {
  console.error(`[config] ${err.message}`);
  process.exit(1);
}

const connectDB = require('./db');
const { createApp } = require('./app');
const { initSocket } = require('./socket');
const { getChainStatus } = require('./services/blockchain');
const chainProofs = require('./services/chainProofs');
const anomaly = require('./services/anomaly');
const safety = require('./services/safety');
const embeddedChain = require('./services/embeddedChain');

const app = createApp();
// One HTTP server shared by Express (REST) and Socket.IO (live push)
const server = http.createServer(app);
initSocket(server);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] Port ${config.port} is already in use. Stop the other process or change PORT in backend/.env`);
    process.exit(1);
  }
  throw err;
});

// Keep running if MongoDB drops later; requests answer 503 until it reconnects
mongoose.connection.on('disconnected', () => console.warn('[db] MongoDB disconnected'));
mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'));

connectDB()
  .then(() => {
    server.listen(config.port, () => {
      console.log(`[server] API running on http://localhost:${config.port} (${config.nodeEnv})`);
      console.log(`[notify] email ${config.emailConfigured ? 'configured' : 'NOT configured'}, sms ${config.smsConfigured ? 'configured' : 'NOT configured'}`);
      chainProofs.startWorker();
      (async () => {
        // Hosting without a shell (e.g. Render free plan): create zones / operator automatically if missing
        if (config.autoSetup) {
          try {
            await require('./services/setup').runSetup();
          } catch (err) {
            console.error(`[setup] ${err.message}`);
          }
        }
        if (config.embeddedChain) await embeddedChain.start();
        // The API also works without the chain (proofs are queued and retried), so just report it
        getChainStatus()
          .then((s) => console.log(`[chain] Contract ${s.address} on chain ${s.chainId}, block ${s.blockNumber} (${s.signer})`))
          .catch((err) => console.warn(`[chain] WARNING: ${err.message}`));
      })();
      anomaly.startSweeper();
      safety.startSweeper();
    });
  })
  .catch((err) => {
    console.error('[db] Could not connect to MongoDB:', err.message);
    console.error('[db] Is mongod running? Check MONGODB_URI in backend/.env');
    process.exit(1);
  });

// Graceful shutdown (Ctrl+C, container stop)
function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down`);
  chainProofs.stopWorker();
  anomaly.stopSweeper();
  safety.stopSweeper();
  embeddedChain.stop();
  server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
