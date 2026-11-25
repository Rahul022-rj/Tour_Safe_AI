// Test harness: a dedicated MongoDB database, a REAL Hardhat node (port 8546) with the contract deployed,
// and the real Express + Socket.IO server listening on a random port.
// Must be required before any app module, because config.js reads the environment once.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const CHAIN_PORT = Number(process.env.TEST_CHAIN_PORT || 8546);
const DEPLOY_FILE = path.join(os.tmpdir(), `toursafe-test-deployment-${process.pid}.json`);

Object.assign(process.env, {
  NODE_ENV: 'test',
  TOURSAFE_SKIP_ENV_FILE: '1',
  MONGODB_URI: process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/tourist_safety_test',
  JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256-signing',
  BCRYPT_ROUNDS: '4',
  BLOCKCHAIN_RPC_URL: `http://127.0.0.1:${CHAIN_PORT}`,
  CHAIN_ID: '31337',
  DEPLOYMENT_FILE: DEPLOY_FILE,
  DISABLE_EXTERNAL_APIS: 'true',
  MIN_LOCATION_INTERVAL_MS: '0',
  CHAIN_RETRY_INTERVAL_MS: '600000',
  CHAIN_TX_TIMEOUT_MS: '15000',
  CLIENT_URL: 'http://localhost:5173',
});

const mongoose = require('mongoose');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const bcrypt = require('bcryptjs');

let chainProc = null;

async function rpcUp() {
  try {
    const res = await fetch(`http://127.0.0.1:${CHAIN_PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function startChain() {
  const bcDir = path.join(__dirname, '..', '..', 'blockchain');
  const cli = path.join(bcDir, 'node_modules', 'hardhat', 'internal', 'cli', 'cli.js');
  chainProc = spawn(process.execPath, [cli, 'node', '--port', String(CHAIN_PORT)], { cwd: bcDir, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    if (await rpcUp()) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!(await rpcUp())) throw new Error('Hardhat test node did not start');
  // Deploy the compiled contract (run "npm run compile --prefix blockchain" first)
  const { ethers } = require('ethers');
  const artifact = JSON.parse(fs.readFileSync(path.join(bcDir, 'artifacts', 'contracts', 'TouristRegistry.sol', 'TouristRegistry.json'), 'utf8'));
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${CHAIN_PORT}`, 31337, { staticNetwork: true });
  const signer = await provider.getSigner(0);
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer).deploy();
  await contract.waitForDeployment();
  fs.writeFileSync(DEPLOY_FILE, JSON.stringify({ address: await contract.getAddress(), chainId: 31337, abi: artifact.abi }));
  provider.destroy();
}

async function stopChain() {
  if (!chainProc) return;
  chainProc.kill();
  for (let i = 0; i < 40 && (await rpcUp()); i++) await new Promise((r) => setTimeout(r, 250));
  chainProc = null;
}

let server = null;
let baseUrl = null;

async function startServer() {
  const { createApp } = require('../app');
  const { initSocket } = require('../socket');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  const models = ['User', 'Zone', 'Station', 'Location', 'Incident', 'Alert', 'Notification', 'AuditLog', 'ChainProof', 'SosLock', 'RiskModel', 'SafetyCheckIn', 'Journey', 'Broadcast'];
  for (const m of models) await require(`../models/${m}`).syncIndexes();
  const app = createApp();
  server = http.createServer(app);
  initSocket(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { app, baseUrl };
}

async function stopServer() {
  const { closeSocket } = require('../socket');
  closeSocket();
  if (server) await new Promise((r) => server.close(r));
  require('../services/blockchain').closeChain();
  await mongoose.disconnect();
  try {
    fs.unlinkSync(DEPLOY_FILE);
  } catch {
    /* ignore */
  }
}

const api = () => request(baseUrl);

let counter = 0;
function touristBody(overrides = {}) {
  counter++;
  const day = 864e5;
  return {
    name: `Test Tourist ${counter}`,
    email: `tourist${counter}.${Date.now()}@example.com`,
    password: 'Str0ng!Pass',
    confirmPassword: 'Str0ng!Pass',
    phone: '+919876543210',
    nationality: 'India',
    govtIdType: 'passport',
    govtId: `P${1000000 + counter}`,
    tripStart: new Date(Date.now() - day).toISOString(),
    tripEnd: new Date(Date.now() + 5 * day).toISOString(),
    emergencyContact: { name: 'Contact Person', phone: '+919812345678', email: 'contact@example.com', relation: 'Friend' },
    ...overrides,
  };
}

async function registerTourist(overrides) {
  const res = await api().post('/api/auth/register').send(touristBody(overrides));
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function createAdmin(email = `admin.${Date.now()}@example.com`, password = 'Adm1n!Pass') {
  const User = require('../models/User');
  await User.create({ name: 'Test Operator', email, role: 'admin', passwordHash: await bcrypt.hash(password, 4) });
  const res = await api().post('/api/auth/login').send({ email, password });
  return res.body;
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const s = ioClient(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (err) => {
      s.close();
      reject(err);
    });
  });
}

// Resolves with the first event payload matching predicate, or rejects after timeout
function waitForEvent(socket, event, predicate = () => true, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeout);
    function handler(data) {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

async function waitFor(fn, { timeout = 20000, interval = 200 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

// A square polygon around [lng, lat] with half-size d degrees (GeoJSON order)
function square(lng, lat, d) {
  return { type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] };
}

module.exports = { startChain, stopChain, startServer, stopServer, api, touristBody, registerTourist, createAdmin, connectSocket, waitForEvent, waitFor, square };
