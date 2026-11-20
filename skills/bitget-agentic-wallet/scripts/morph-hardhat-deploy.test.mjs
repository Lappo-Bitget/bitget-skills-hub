import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { parseCli, quantity, loadInputs } from './morph-hardhat-deploy.mjs';

const ethers = {
  toBeHex(value) {
    let hex = BigInt(value).toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    return `0x${hex}`;
  },
  Interface: class {
    constructor(abi) { this.abi = abi; }
    encodeDeploy(args) {
      assert.deepEqual(this.abi, ['constructor(address owner, uint256 count)']);
      assert.deepEqual(args, ['0x0000000000000000000000000000000000000001', '7']);
      return '0xdeadbeef';
    }
  }
};

test('parses preview and confirmation as distinct operations', () => {
  assert.deepEqual(parseCli(['--artifact', 'a.json', '--args-file', 'args.json', '--plan']), {
    artifact: 'a.json', argsFile: 'args.json', plan: true
  });
  assert.deepEqual(parseCli(['--artifact', 'a.json', '--args-file', 'args.json', '--confirm', 'MORPH-DEPLOY-2818-ABCDEF12']), {
    artifact: 'a.json', argsFile: 'args.json', confirm: 'MORPH-DEPLOY-2818-ABCDEF12'
  });
});

test('rejects key-bearing options and mixed approval modes', () => {
  assert.throws(() => parseCli(['--private-key', 'not-printed']), /Unknown option/);
  assert.throws(() => parseCli(['--artifact', 'a', '--args-file', 'b', '--plan', '--confirm', 'x']), /Choose either/);
  assert.throws(() => parseCli(['--artifact', 'a', '--args-file', 'b']), /exactly one/);
});

test('formats RLP quantities as minimal byte strings', () => {
  assert.equal(quantity(ethers, 0n), '0x');
  assert.equal(quantity(ethers, 4n), '0x04');
  assert.equal(quantity(ethers, 2818n), '0x0b02');
});

test('loads Hardhat artifact and appends ABI-encoded constructor args', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'morph-hardhat-helper-'));
  try {
    const artifactPath = path.join(dir, 'Sample.json');
    const argsPath = path.join(dir, 'args.json');
    await fs.writeFile(artifactPath, JSON.stringify({
      contractName: 'Sample',
      abi: ['constructor(address owner, uint256 count)'],
      bytecode: '0x60006000'
    }));
    await fs.writeFile(argsPath, JSON.stringify(['0x0000000000000000000000000000000000000001', '7']));
    const result = await loadInputs(ethers, { artifact: artifactPath, argsFile: argsPath });
    assert.equal(result.artifact.contractName, 'Sample');
    assert.equal(result.constructorData, '0xdeadbeef');
    assert.equal(result.initCode, `${result.bytecode}${result.constructorData.slice(2)}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('rejects malformed artifact bytecode and non-array arguments', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'morph-hardhat-invalid-'));
  try {
    const artifactPath = path.join(dir, 'Sample.json');
    const argsPath = path.join(dir, 'args.json');
    await fs.writeFile(artifactPath, JSON.stringify({ contractName: 'Sample', abi: [], bytecode: '0x' }));
    await fs.writeFile(argsPath, '[]');
    await assert.rejects(loadInputs(ethers, { artifact: artifactPath, argsFile: argsPath }), /bytecode is empty/);
    await fs.writeFile(artifactPath, JSON.stringify({ contractName: 'Sample', abi: [], bytecode: '0x6000' }));
    await fs.writeFile(argsPath, '{}');
    await assert.rejects(loadInputs(ethers, { artifact: artifactPath, argsFile: argsPath }), /JSON array/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
