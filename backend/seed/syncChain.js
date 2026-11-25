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
const chain = require('../services/blockchain');
const { resyncAll } = require('../services/chainSync');

async function sync() {
  if (config.chainId !== 31337 && !process.argv.includes('--force')) {
    throw new Error(`CHAIN_ID is ${config.chainId}: refusing to re-anchor data on a persistent chain (use --force if you really mean it)`);
  }
  await connectDB();
  const status = await chain.getChainStatus();
  console.log(`[sync] Contract ${status.address}, block ${status.blockNumber}`);
  await resyncAll();
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
