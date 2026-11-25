// Unit tests for the TouristRegistry contract (run: npm test --prefix blockchain)
const { expect } = require('chai');
const { ethers } = require('hardhat');

const h = (s) => ethers.sha256(ethers.toUtf8Bytes(s));

describe('TouristRegistry', () => {
  let registry;
  let owner;
  let other;

  beforeEach(async () => {
    [owner, other] = await ethers.getSigners();
    registry = await ethers.deployContract('TouristRegistry');
    await registry.waitForDeployment();
  });

  it('sets the deployer as owner', async () => {
    expect(await registry.owner()).to.equal(owner.address);
  });

  it('registers an ID and verifies it', async () => {
    const id = h('tourist-1');
    await expect(registry.registerID(id)).to.emit(registry, 'IDRegistered');
    expect(await registry.registered(id)).to.equal(true);
    expect(await registry.verifyID(id)).to.equal(true);
  });

  it('rejects duplicate registration', async () => {
    const id = h('tourist-2');
    await registry.registerID(id);
    await expect(registry.registerID(id)).to.be.revertedWith('Already registered');
  });

  it('revokes a registered ID; verifyID becomes false', async () => {
    const id = h('tourist-3');
    await registry.registerID(id);
    await expect(registry.revokeID(id)).to.emit(registry, 'IDRevoked');
    expect(await registry.revoked(id)).to.equal(true);
    expect(await registry.verifyID(id)).to.equal(false);
    await expect(registry.revokeID(id)).to.be.revertedWith('Already revoked');
  });

  it('cannot revoke an unknown ID', async () => {
    await expect(registry.revokeID(h('nobody'))).to.be.revertedWith('Unknown ID');
  });

  it('logs an incident hash once with its block time', async () => {
    const inc = h('incident-1');
    await expect(registry.logIncident(inc)).to.emit(registry, 'IncidentLogged');
    expect(await registry.incidentLoggedAt(inc)).to.be.greaterThan(0n);
    await expect(registry.logIncident(inc)).to.be.revertedWith('Already logged');
    expect(await registry.incidentLoggedAt(h('never'))).to.equal(0n);
  });

  it('only the owner can write', async () => {
    const id = h('tourist-4');
    await expect(registry.connect(other).registerID(id)).to.be.revertedWith('Only owner');
    await expect(registry.connect(other).logIncident(id)).to.be.revertedWith('Only owner');
    await registry.registerID(id);
    await expect(registry.connect(other).revokeID(id)).to.be.revertedWith('Only owner');
  });
});
