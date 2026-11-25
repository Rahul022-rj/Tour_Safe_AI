// Embedded demo blockchain (EMBEDDED_CHAIN=true), for hosting where a separate blockchain server is not available.
//
// On server start it launches a Hardhat node as a child process (listening on 127.0.0.1 only), deploys the
// TouristRegistry contract from the compiled artifact, and re-anchors every proof stored in MongoDB.
// If the node crashes it is restarted and re-anchored again.
//
// HONEST LIMITATION: this chain lives in memory. Every server restart (and free-tier sleep) starts a new chain
// that is rebuilt from the database, so it demonstrates the mechanism but is not an independent tamper-proof
// record. Use a persistent network (BLOCKCHAIN_RPC_URL + PRIVATE_KEY + CONTRACT_ADDRESS) for that.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ethers } = require('ethers');
const config = require('../config');

const BLOCKCHAIN_DIR = path.join(__dirname, '..', '..', 'blockchain');
const ARTIFACT = path.join(BLOCKCHAIN_DIR, 'artifacts', 'contracts', 'TouristRegistry.sol', 'TouristRegistry.json');

let child = null;
let stopping = false;
const state = { status: 'stopped', startedAt: null, address: null, lastError: null, restarts: 0 };

async function rpcUp(url) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deployContract(url) {
  if (!fs.existsSync(ARTIFACT)) throw new Error('Contract artifact missing: run "npm run chain:compile" during the build');
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const provider = new ethers.JsonRpcProvider(url, 31337, { staticNetwork: true });
  try {
    const signer = await provider.getSigner(0);
    const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer).deploy();
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    fs.mkdirSync(path.dirname(config.deploymentFile), { recursive: true });
    fs.writeFileSync(config.deploymentFile, JSON.stringify({ address, chainId: 31337, network: 'embedded', deployedAt: new Date().toISOString(), abi: artifact.abi }, null, 2));
    return address;
  } finally {
    provider.destroy();
  }
}

async function launch() {
  const cli = path.join(BLOCKCHAIN_DIR, 'node_modules', 'hardhat', 'internal', 'cli', 'cli.js');
  if (!fs.existsSync(cli)) throw new Error('Hardhat is not installed in blockchain/ (install with --include=dev)');
  state.status = 'starting';
  child = spawn(process.execPath, [cli, 'node', '--hostname', '127.0.0.1', '--port', String(config.embeddedChainPort)], {
    cwd: BLOCKCHAIN_DIR,
    stdio: 'ignore',
    env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: 'true' },
  });
  child.on('exit', (code) => {
    child = null;
    if (stopping) return;
    state.status = 'crashed';
    state.lastError = `Hardhat node exited with code ${code}`;
    console.error(`[chain] Embedded blockchain stopped (code ${code}); restarting in 5 s`);
    state.restarts++;
    setTimeout(() => start().catch((err) => console.error(`[chain] restart failed: ${err.message}`)), 5000).unref();
  });

  for (let i = 0; i < 120; i++) {
    if (await rpcUp(config.chainRpcUrl)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!(await rpcUp(config.chainRpcUrl))) throw new Error('Embedded Hardhat node did not start within 60 s');
}

// Starts the chain, deploys the contract, re-anchors all proofs. Never throws to the caller's process.
async function start() {
  if (child) return state;
  try {
    await launch();
    state.address = await deployContract(config.chainRpcUrl);
    require('./blockchain').closeChain(); // forget any cached provider/contract from a previous chain
    state.status = 'syncing';
    console.log(`[chain] Embedded blockchain running, TouristRegistry at ${state.address}; re-anchoring stored proofs…`);
    await require('./chainSync').resyncAll((m) => console.log(m));
    state.status = 'ready';
    state.startedAt = new Date();
    state.lastError = null;
  } catch (err) {
    state.status = 'error';
    state.lastError = err.message;
    console.error(`[chain] Embedded blockchain failed: ${err.message}`);
  }
  return state;
}

function stop() {
  stopping = true;
  if (child) child.kill();
  child = null;
  state.status = 'stopped';
}

const getState = () => ({ ...state });

module.exports = { start, stop, getState };
