// Creates an operator (admin) account without wiping any data. Public registration can never create one.
// Usage: npm run create-admin --prefix backend -- --name "Control Room" --email ops@example.com --password "Str0ng!Pass"
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const connectDB = require('../db');
const User = require('../models/User');
const { isEmail, passwordProblems } = require('../utils/validate');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg('name');
  const email = String(arg('email') || '').toLowerCase();
  const password = arg('password');
  if (!name || !isEmail(email)) throw new Error('Usage: --name "Name" --email you@example.com --password "Str0ng!Pass"');
  const problems = passwordProblems(password);
  if (problems.length) throw new Error(`Password needs ${problems.join(', ')}`);
  await connectDB();
  if (await User.exists({ email })) throw new Error('An account with this email already exists');
  await User.create({ name, email, role: 'admin', passwordHash: await bcrypt.hash(password, config.bcryptRounds), passwordChangedAt: new Date() });
  console.log(`[admin] Operator ${email} created`);
}

main()
  .catch((err) => {
    console.error(`[admin] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
