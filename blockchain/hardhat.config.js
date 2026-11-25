require('@nomicfoundation/hardhat-toolbox'); // adds hre.ethers (ethers v6) and the test runner

// Optional persistent network (testnet or permissioned chain), configured only through environment variables:
//   DEPLOY_RPC_URL=https://...   DEPLOY_PRIVATE_KEY=0x...   DEPLOY_CHAIN_ID=11155111
// Never commit real keys: put them in your shell environment or a local, git-ignored file.
const networks = {
  // The node started by "npm run chain" (hardhat node). Chain id 31337, in memory, resets on restart.
  localhost: { url: 'http://127.0.0.1:8545', chainId: 31337 },
};
if (process.env.DEPLOY_RPC_URL && process.env.DEPLOY_PRIVATE_KEY) {
  networks.custom = {
    url: process.env.DEPLOY_RPC_URL,
    accounts: [process.env.DEPLOY_PRIVATE_KEY],
    chainId: process.env.DEPLOY_CHAIN_ID ? Number(process.env.DEPLOY_CHAIN_ID) : undefined,
  };
}

module.exports = {
  solidity: { version: '0.8.24', settings: { optimizer: { enabled: true, runs: 200 } } },
  networks,
};
