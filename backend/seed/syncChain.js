// Rebuilds the blockchain records from MongoDB WITHOUT wiping any data.
// Needed because the local Hardhat node keeps its chain in memory: after a restart + redeploy it is empty again.
// Run with:  npm run chain:sync   (after "npm run chain" and "npm run chain:deploy")
//
// IMPORTANT: this re-anchors whatever is CURRENTLY in MongoDB. On a persistent chain (testnet / permissioned
// network) the chain is never reset and this script is not needed; there, re-anchoring would defeat the purpose
// of tamper evidence, so the script refuses to run unless CHAIN_ID is 31337 or --force is given.
const mongoose = require('mongoose');
const config = require('../config');
const connectDB = require('../db');
const User = require('../models/User');
const Incident = require('../models/Incident');
const ChainProof = require('../models/ChainProof');
const chain = require('../services/blockchain');
const chainProofs = require('../services/chainProofs');
const { computeIncidentHash } = require('../utils/incidentHash');

async function onChain(proof) {
  if (proof.kind === 'ID_REGISTER') return (await chain.getIdStatus(proof.hash)).registered;
  if (proof.kind === 'ID_REVOKE') return (await chain.getIdStatus(proof.hash)).revoked;
  return (await chain.getIncidentLoggedAt(proof.hash)) > 0;
}

async function sync() {
  if (config.chainId !== 31337 && !process.argv.includes('--force')) {
    throw new Error(`CHAIN_ID is ${config.chainId}: refusing to re-anchor data on a persistent chain (use --force if you really mean it)`);
  }
  await connectDB();
  const status = await chain.getChainStatus();
  console.log(`[sync] Contract ${status.address}, block ${status.blockNumber}`);

  // 1. Make sure every tourist ID, revocation and current incident state has a proof record
  const tourists = await User.find({ role: 'tourist', idHash: { $exists: true } }).lean();
  for (const t of tourists) {
    await ChainProof.updateOne({ kind: 'ID_REGISTER', hash: t.idHash }, { $setOnInsert: { refId: t._id, status: 'pending' } }, { upsert: true });
    if (t.idRevokedAt) await ChainProof.updateOne({ kind: 'ID_REVOKE', hash: t.idHash }, { $setOnInsert: { refId: t._id, status: 'pending' } }, { upsert: true });
  }
  const incidents = await Incident.find().lean();
  for (const inc of incidents) {
    await ChainProof.updateOne(
      { kind: 'INCIDENT', hash: computeIncidentHash(inc) },
      { $setOnInsert: { refId: inc._id, status: 'pending', revision: inc.revision || 0 } },
      { upsert: true }
    );
  }

  // 2. Send every proof that is not actually on chain (registrations before revocations)
  const order = { ID_REGISTER: 0, ID_REVOKE: 1, INCIDENT: 2 };
  const proofs = (await ChainProof.find().lean()).sort((a, b) => order[a.kind] - order[b.kind] || a.createdAt - b.createdAt);
  const counts = { already: 0, sent: 0, failed: 0 };
  for (const p of proofs) {
    if (await onChain(p)) {
      if (p.status !== 'confirmed') await ChainProof.updateOne({ _id: p._id }, { status: 'confirmed', confirmedAt: p.confirmedAt || new Date() });
      counts.already++;
      continue;
    }
    await ChainProof.updateOne({ _id: p._id }, { status: 'pending', attempts: 0 });
    const result = await chainProofs.attempt(p._id);
    if (result.status === 'confirmed') counts.sent++;
    else {
      counts.failed++;
      console.warn(`[sync] ${p.kind} ${p.hash.slice(0, 12)}... failed: ${result.lastError}`);
    }
  }
  console.log(`[sync] Proofs: ${counts.sent} sent, ${counts.already} already on chain, ${counts.failed} failed`);
}

sync()
  .catch((err) => {
    console.error('[sync] Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    chain.closeChain();
    return mongoose.disconnect();
  });
