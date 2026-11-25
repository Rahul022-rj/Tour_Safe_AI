// Blockchain proof lifecycle shared by Digital IDs and incidents.
//
//   pending   -> saved in MongoDB, not yet sent
//   submitted -> transaction sent, waiting for confirmation
//   confirmed -> mined with CHAIN_CONFIRMATIONS confirmations (only now is it reported as "on chain")
//   failed    -> last attempt failed; the worker retries it every CHAIN_RETRY_INTERVAL_MS (up to CHAIN_MAX_ATTEMPTS)
//
// Callers never wait for the chain on safety-critical paths (SOS, registration): they call submit() and move on.
const config = require('../config');
const ChainProof = require('../models/ChainProof');
const User = require('../models/User');
const Incident = require('../models/Incident');
const chain = require('./blockchain');

const SENDERS = {
  ID_REGISTER: chain.registerId,
  ID_REVOKE: chain.revokeId,
  INCIDENT: chain.logIncidentHash,
};

// Copies the outcome onto the User / Incident so lists can show it without a join
async function denormalize(proof) {
  if (proof.kind === 'ID_REGISTER') {
    await User.updateOne(
      { _id: proof.refId, idHash: proof.hash },
      { idChainStatus: proof.status === 'submitted' ? 'pending' : proof.status, ...(proof.txHash && { idTxHash: proof.txHash }) }
    );
  } else if (proof.kind === 'ID_REVOKE') {
    if (proof.status === 'confirmed' && proof.txHash) await User.updateOne({ _id: proof.refId }, { idRevokeTxHash: proof.txHash });
  } else if (proof.kind === 'INCIDENT') {
    const latest = await ChainProof.findOne({ kind: 'INCIDENT', refId: proof.refId }).sort({ revision: -1, createdAt: -1 }).lean();
    const update = { chainStatus: latest.status === 'submitted' ? 'pending' : latest.status };
    if (proof.status === 'confirmed') {
      // Only move the "latest confirmed proof" pointer forward
      const lastConfirmed = await ChainProof.findOne({ kind: 'INCIDENT', refId: proof.refId, status: 'confirmed' }).sort({ revision: -1, confirmedAt: -1 }).lean();
      Object.assign(update, { chainHash: lastConfirmed.hash, chainTxHash: lastConfirmed.txHash, chainLoggedAt: lastConfirmed.confirmedAt });
    }
    await Incident.updateOne({ _id: proof.refId }, update);
    // Live dashboards update the proof badge without a reload
    require('../socket').emitToAdmins('incident:chain', { _id: String(proof.refId), ...update });
  }
}

// One attempt at sending a proof. Resolves with the updated proof; never throws.
async function attempt(proofId) {
  // Claim the proof atomically so two workers/instances never send the same one at the same time
  const proof = await ChainProof.findOneAndUpdate(
    { _id: proofId, status: { $in: ['pending', 'failed', 'submitted'] } },
    { $set: { status: 'submitted' }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (!proof) return ChainProof.findById(proofId).lean();
  await denormalize(proof);
  try {
    const result = await SENDERS[proof.kind](proof.hash);
    proof.status = 'confirmed';
    proof.txHash = result.txHash || proof.txHash;
    proof.blockNumber = result.blockNumber || proof.blockNumber;
    proof.confirmedAt = new Date();
    proof.chainId = config.chainId;
    proof.lastError = result.alreadyDone && !result.txHash ? 'Already on chain (confirmed by on-chain read)' : undefined;
  } catch (err) {
    proof.status = 'failed';
    proof.lastError = String(err.message).slice(0, 300);
  }
  await proof.save();
  await denormalize(proof);
  if (proof.kind === 'ID_REGISTER' && (proof.status === 'confirmed' || proof.attempts === 1)) {
    // Tell the tourist (their Digital ID page refreshes itself on this alert)
    const { notifyTourist } = require('./alerts');
    const ok = proof.status === 'confirmed';
    notifyTourist(
      proof.refId,
      ok ? 'Digital ID confirmed' : 'Digital ID registration delayed',
      ok ? 'Your Digital ID is now registered on the blockchain.' : 'The blockchain is not reachable right now. Your Digital ID registration will be retried automatically.',
      'ID_STATUS'
    ).catch(() => {});
  }
  return proof.toObject();
}

// Create (or reuse) a proof record and try to send it. Returns the proof promise; callers may ignore it.
async function submit(kind, refId, hash, revision) {
  let proof;
  try {
    proof = await ChainProof.findOneAndUpdate(
      { kind, hash },
      { $setOnInsert: { kind, refId, hash, revision, status: 'pending' } },
      { upsert: true, new: true }
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
    proof = await ChainProof.findOne({ kind, hash }); // two submits raced; use the winner's record
  }
  if (proof.status === 'confirmed') return proof.toObject();
  await denormalize(proof);
  return attempt(proof._id);
}

// Fire-and-forget variant for request handlers
function submitInBackground(kind, refId, hash, revision) {
  submit(kind, refId, hash, revision).catch((err) => console.error(`[chain] could not queue ${kind} proof: ${err.message}`));
}

// ----- Retry worker -----
let timer = null;
let running = false;

async function retryFailed() {
  if (running) return 0;
  running = true;
  let done = 0;
  try {
    const staleSubmitted = new Date(Date.now() - Math.max(config.chainTxTimeoutMs * 2, 60000));
    const due = await ChainProof.find({
      attempts: { $lt: config.chainMaxAttempts },
      $or: [{ status: { $in: ['pending', 'failed'] } }, { status: 'submitted', updatedAt: { $lt: staleSubmitted } }],
    })
      .sort({ createdAt: 1 })
      .limit(25)
      .lean();
    for (const p of due) {
      const result = await attempt(p._id);
      if (result?.status === 'confirmed') done++;
      else if (result?.lastError && /not reachable|not deployed|No contract/i.test(result.lastError)) break; // chain down: stop for now
    }
  } catch (err) {
    console.warn(`[chain] retry worker: ${err.message}`);
  } finally {
    running = false;
  }
  return done;
}

function startWorker() {
  if (timer) return;
  timer = setInterval(() => retryFailed().catch(() => {}), config.chainRetryIntervalMs);
  timer.unref();
}

function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { submit, submitInBackground, attempt, retryFailed, startWorker, stopWorker };
