// First-time setup. Safe to run again at any time: it only ADDS what is missing and never touches real users.
//   - safety zones for Hyderabad (only if there are no zones yet; operators manage them in the Zone manager)
//   - sample police stations / hospitals (only if none exist; labelled DEMO in the app)
//   - one operator account (only if no operator exists yet)
// Tourists are NOT created here: real users register themselves on the website.
//
// Usage:
//   npm run setup                                                     # operator from SETUP_ADMIN_* env vars or the dev default
//   npm run setup -- --admin-email ops@city.gov --admin-password "Str0ng!Pass" --admin-name "Control Room"
//   npm run setup -- --reset --yes                                    # DELETES ALL DATA first (development only)
const mongoose = require('mongoose');
const config = require('../config');
const connectDB = require('../db');
const { runSetup } = require('../services/setup');
const { closeChain } = require('../services/blockchain');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const flag = (name) => process.argv.includes(`--${name}`);

async function main() {
  if (flag('reset') && !flag('yes')) throw new Error('--reset deletes ALL users, incidents and history. Add --yes to confirm.');
  await connectDB();
  await runSetup({ reset: flag('reset'), adminEmail: arg('admin-email'), adminPassword: arg('admin-password'), adminName: arg('admin-name') });
  console.log(`[setup] Tourists register themselves at ${config.clientUrl}/register`);
}

main()
  .catch((err) => {
    console.error('[setup] Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    closeChain();
    return mongoose.disconnect();
  });
