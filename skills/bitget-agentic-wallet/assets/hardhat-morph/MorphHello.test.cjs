const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('MorphHello', function () {
  it('returns a greeting', async function () {
    const Factory = await ethers.getContractFactory('MorphHello');
    const hello = await Factory.deploy();
    await hello.waitForDeployment();
    expect(await hello.greeting()).to.equal('Hello, Morph');
  });
});
