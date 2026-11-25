// Re-anchors every proof recorded in MongoDB onto the blockchain (used after a local/embedded chain restarted
// empty). Only meaningful for the development / demo chain (31337): on a persistent chain nothing is ever lost,
// and re-anchoring current data would defeat tamper evidence.
const User = require('../models/User');
const Incident = require('../models/Incident');
const ChainProof = require('../models/ChainProof');
const chain = require('./blockchain');
const chainProofs = require('./chainProofs');
const { computeIncidentHash } = require('../utils/incidentHash');

async function onChain(proof) {
  if (proof.kind === 'ID_REGISTER') return (await chain.getIdStatus(proof.hash)).registered;
  if (proof.kind === 'ID_REVOKE') return (await chain.getIdStatus(proof.hash)).revoked;
  return (await chain.getIncidentLoggedAt(proof.hash)) > 0;
}

async function resyncAll(log = console.log) {
  // 1. Make sure every tourist ID, revocation and current incident state has a proof record
  const tourists = await User.find({ role: 'tourist', idHash: { $exists: true } }).lean();
  for (const t of tourists) {
    await ChainProof.updateOne({ kind: 'ID_REGISTER', hash: t.idHash }, { $setOnInsert: { refId: t._id, status: 'pending' } }, { upsert: true });
    if (t.idRevokedAt) await ChainProof.updateOne({ kind: 'ID_REVOKE', hash: t.idHash }, { $setOnInsert: { refId: t._id, status: 'pending' } }, { upsert: true });
  }
  for (const inc of await Incident.find().lean()) {
    await ChainProof.updateOne(
      { kind: 'INCIDENT', hash: computeIncidentHash(inc) },
      { $setOnInsert: { refId: inc._id, status: 'pending', revision: inc.revision || 0 } },
      { upsert: true }
    );
  }

  // 2. Send every proof that is not actually on chain (registrations before revocations)
  const order = { ID_REGISTER: 0, ID_REVOKE: 1, INCIDENT: 2 };
  const proofs = (await ChainProof.find().lean()).sort((a, b) => order[a.kind] - order[b.kind] || a.createdAt - b.createdAt);
  const counts = { sent: 0, already: 0, failed: 0 };
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
      log(`[sync] ${p.kind} ${p.hash.slice(0, 12)}... failed: ${result.lastError}`);
    }
  }
  log(`[sync] Proofs: ${counts.sent} sent, ${counts.already} already on chain, ${counts.failed} failed`);
  return counts;
}

module.exports = { resyncAll };
