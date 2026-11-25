// Talks to the TouristRegistry contract using ethers v6.
//  - RPC URL, chain id, contract address and signing key come from config (environment variables).
//  - If CONTRACT_ADDRESS is empty, the address is read from blockchain/deployment.json (written by the deploy script)
//    and re-read whenever that file changes, so a redeploy needs no backend restart.
//  - Signing: PRIVATE_KEY if set; otherwise, ONLY on the local Hardhat chain (31337), the node's unlocked account #0.
//  - Every write is idempotent (checks the on-chain state first) so the retry worker can safely repeat it,
//    and writes are serialized so two concurrent transactions never fight over the same nonce.
const fs = require('fs');
const { ethers } = require('ethers');
const config = require('../config');

// Human-readable ABI of contracts/TouristRegistry.sol (kept here so the backend does not depend on build artifacts)
const ABI = [
  'function owner() view returns (address)',
  'function registered(bytes32) view returns (bool)',
  'function revoked(bytes32) view returns (bool)',
  'function incidentLoggedAt(bytes32) view returns (uint256)',
  'function verifyID(bytes32 idHash) view returns (bool)',
  'function registerID(bytes32 idHash)',
  'function revokeID(bytes32 idHash)',
  'function logIncident(bytes32 incidentHash)',
  'event IDRegistered(bytes32 indexed idHash, uint256 timestamp)',
  'event IDRevoked(bytes32 indexed idHash, uint256 timestamp)',
  'event IncidentLogged(bytes32 indexed incidentHash, uint256 timestamp)',
];

let cached = { key: '', provider: null, address: null, signer: null };

// Error with an HTTP status the central error handler can use
const chainError = (status, message, code = 'CHAIN_ERROR') => Object.assign(new Error(message), { status, code, expose: true });

// The contract's require() message. Depending on how the node reports the revert, ethers puts it in
// err.reason or only inside the nested node error text ("reverted with reason string '...'").
function revertReason(err) {
  if (err.reason) return err.reason;
  const text = [err.error?.message, err.info?.error?.message, err.message].filter(Boolean).join(' ');
  const match = text.match(/reverted with reason string '([^']+)'/);
  return match ? match[1] : null;
}

// Turn low-level ethers errors into messages a user understands
function friendly(err) {
  if (err.status) return err; // already friendly
  if (err.code === 'ECONNREFUSED' || err.code === 'TIMEOUT' || /ECONNREFUSED|fetch failed|timeout|ENOTFOUND|socket hang up/i.test(err.message)) {
    return chainError(503, `Blockchain node not reachable at ${config.chainRpcUrl}. Start it with: npm run chain`, 'CHAIN_UNAVAILABLE');
  }
  if (err.code === 'BAD_DATA' || err.code === 'CALL_EXCEPTION' && !revertReason(err)) {
    return chainError(503, 'No contract at the configured address (a local Hardhat node was probably restarted). Run: npm run chain:deploy, then npm run chain:sync', 'CHAIN_NO_CONTRACT');
  }
  const reason = revertReason(err);
  if (reason) return chainError(400, `Blockchain rejected the request: ${reason}`, 'CHAIN_REVERT');
  return chainError(502, `Blockchain error: ${err.shortMessage || err.message}`);
}

function contractAddress() {
  if (config.contractAddress) return { address: config.contractAddress, key: `env:${config.contractAddress}` };
  let stat;
  try {
    stat = fs.statSync(config.deploymentFile);
  } catch {
    throw chainError(503, 'Contract not deployed yet. Run: npm run chain:deploy (or set CONTRACT_ADDRESS)', 'CHAIN_NOT_DEPLOYED');
  }
  const deployment = JSON.parse(fs.readFileSync(config.deploymentFile, 'utf8'));
  if (deployment.chainId && Number(deployment.chainId) !== config.chainId) {
    throw chainError(503, `deployment.json is for chain ${deployment.chainId} but CHAIN_ID is ${config.chainId}`, 'CHAIN_MISMATCH');
  }
  return { address: deployment.address, key: `file:${stat.mtimeMs}:${deployment.address}` };
}

function load() {
  const { address, key } = contractAddress();
  const fullKey = `${key}|${config.chainRpcUrl}|${config.chainId}`;
  if (fullKey !== cached.key) {
    if (cached.provider) cached.provider.destroy();
    const request = new ethers.FetchRequest(config.chainRpcUrl);
    request.timeout = 5000; // fail fast instead of ethers' 5 minute default
    const network = ethers.Network.from(config.chainId);
    // staticNetwork: skip ethers' network auto-detection, which retries forever while the node is down
    const provider = new ethers.JsonRpcProvider(request, network, { staticNetwork: network });
    cached = { key: fullKey, provider, address, signer: null };
  }
  return cached;
}

async function getSigner() {
  const c = load();
  if (c.signer) return c.signer;
  if (config.privateKey) {
    // NonceManager keeps track of the nonce locally so back-to-back transactions do not collide
    c.signer = new ethers.NonceManager(new ethers.Wallet(config.privateKey, c.provider));
  } else if (config.chainId === 31337) {
    // Local development only: the Hardhat node holds account #0's key and signs for us
    c.signer = await c.provider.getSigner(0);
  } else {
    throw chainError(503, 'PRIVATE_KEY is not configured for this blockchain network', 'CHAIN_NO_SIGNER');
  }
  return c.signer;
}

const reader = () => {
  const { provider, address } = load();
  return new ethers.Contract(address, ABI, provider);
};

// Serializes writes: each transaction waits for the previous one to finish
let queue = Promise.resolve();
function serialize(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// Sends a transaction, waits for CHAIN_CONFIRMATIONS confirmations, returns { txHash, blockNumber, alreadyDone }
// alreadyDoneCheck() lets retries succeed when an earlier attempt was in fact mined.
function send(method, hash, alreadyDoneCheck) {
  return serialize(async () => {
    try {
      if (alreadyDoneCheck && (await alreadyDoneCheck())) return { txHash: null, blockNumber: null, alreadyDone: true };
      const signer = await getSigner();
      const contract = new ethers.Contract(load().address, ABI, signer);
      const tx = await contract[method](hash);
      const receipt = await tx.wait(config.chainConfirmations, config.chainTxTimeoutMs);
      if (!receipt || receipt.status !== 1) throw chainError(502, `Transaction ${tx.hash} failed on chain`, 'CHAIN_TX_FAILED');
      return { txHash: receipt.hash, blockNumber: receipt.blockNumber, alreadyDone: false };
    } catch (err) {
      if (err.code === 'NONCE_EXPIRED' || /nonce/i.test(err.message || '')) cached.signer = null; // resync nonce next time
      throw friendly(err);
    }
  });
}

const registerId = (idHash) => send('registerID', idHash, () => reader().registered(idHash));
const revokeId = (idHash) => send('revokeID', idHash, () => reader().revoked(idHash));
const logIncidentHash = (incidentHash) => send('logIncident', incidentHash, async () => Number(await reader().incidentLoggedAt(incidentHash)) > 0);

// { registered, revoked, valid } where valid = the contract's verifyID()
async function getIdStatus(idHash) {
  try {
    const c = reader();
    const [registered, revoked, valid] = await Promise.all([c.registered(idHash), c.revoked(idHash), c.verifyID(idHash)]);
    return { registered, revoked, valid };
  } catch (err) {
    throw friendly(err);
  }
}

// Block time (seconds) when this incident hash was logged, or 0 if it never was
async function getIncidentLoggedAt(incidentHash) {
  try {
    return Number(await reader().incidentLoggedAt(incidentHash));
  } catch (err) {
    throw friendly(err);
  }
}

// Health check: node reachable, right chain, contract code present
async function getChainStatus() {
  try {
    const { provider, address } = load();
    const [blockNumber, code, net] = await Promise.all([
      provider.getBlockNumber(),
      provider.getCode(address),
      provider.send('eth_chainId', []),
    ]);
    const actualChainId = Number(net);
    if (actualChainId !== config.chainId) {
      throw chainError(503, `RPC node is chain ${actualChainId}, expected CHAIN_ID ${config.chainId}`, 'CHAIN_MISMATCH');
    }
    if (code === '0x') throw Object.assign(new Error('no contract'), { code: 'BAD_DATA' });
    return {
      ok: true,
      address,
      chainId: actualChainId,
      blockNumber,
      rpcUrl: config.chainRpcUrl.replace(/\/\/[^@/]*@/, '//***@'), // hide credentials embedded in RPC URLs
      signer: config.privateKey ? 'wallet (PRIVATE_KEY)' : 'hardhat unlocked account #0 (dev only)',
      persistent: config.chainId !== 31337,
    };
  } catch (err) {
    throw friendly(err);
  }
}

// Lets scripts (seed, sync) and tests exit cleanly
function closeChain() {
  if (cached.provider) cached.provider.destroy();
  cached = { key: '', provider: null, address: null, signer: null };
}

module.exports = { ABI, registerId, revokeId, logIncidentHash, getIdStatus, getIncidentLoggedAt, getChainStatus, closeChain };
