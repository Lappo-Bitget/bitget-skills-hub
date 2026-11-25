import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'ethers';
import { createLocalSigner, signAndBroadcastMorph } from './local-signer.mjs';

const testKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

test('accepts a private key only in the local signer helper and derives an address', () => {
  const signer = createLocalSigner(testKey);
  assert.equal(signer.address.toLowerCase(), '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
  assert.throws(() => createLocalSigner('not-a-private-key'), /valid 32-byte/);
});

test('signs and broadcasts a Morph BGB-alt-fee transaction', async () => {
  const signer = createLocalSigner(testKey);
  const sent = [];
  const provider = {
    async send(method, params) {
      if (method === 'eth_chainId') return '0xb02';
      if (method === 'eth_gasPrice') return '0x3b9aca00';
      if (method === 'eth_maxPriorityFeePerGas') return '0x1';
      if (method === 'eth_estimateGas') return '0x5208';
      if (method === 'eth_sendRawTransaction') { sent.push(params[0]); return keccak256(params[0]); }
      throw new Error(`Unexpected RPC method ${method}`);
    },
    async getTransactionCount() { return 2; }
  };

  const result = await signAndBroadcastMorph({
    signer,
    provider,
    transaction: { to: '0x1111111111111111111111111111111111111111', data: '0x12345678', value: '0' },
    feeLimitWei: '10000000000000000'
  });

  assert.equal(result.hash, keccak256(sent[0]));
  assert.equal(result.gasLimit, '25200');
  assert.match(sent[0], /^0x7f/);
});

test('refuses to sign when the RPC chain is not Morph Mainnet', async () => {
  const signer = createLocalSigner(testKey);
  const provider = { async send(method) { return method === 'eth_chainId' ? '0x1' : assert.fail('must not continue'); } };
  await assert.rejects(() => signAndBroadcastMorph({
    signer,
    provider,
    transaction: { to: '0x1111111111111111111111111111111111111111', data: '0x12345678', value: '0' },
    feeLimitWei: '10000000000000000'
  }), /not Morph Mainnet/);
});

test('reports a locally computed hash when raw transaction broadcast is uncertain', async () => {
  const signer = createLocalSigner(testKey);
  let rawTransaction;
  const provider = {
    async send(method, params) {
      if (method === 'eth_chainId') return '0xb02';
      if (method === 'eth_gasPrice') return '0x3b9aca00';
      if (method === 'eth_maxPriorityFeePerGas') return '0x1';
      if (method === 'eth_estimateGas') return '0x5208';
      if (method === 'eth_sendRawTransaction') { rawTransaction = params[0]; throw new Error('connection lost'); }
      throw new Error(`Unexpected RPC method ${method}`);
    },
    async getTransactionCount() { return 2; }
  };

  await assert.rejects(
    () => signAndBroadcastMorph({
      signer,
      provider,
      transaction: { to: '0x1111111111111111111111111111111111111111', data: '0x12345678', value: '0' },
      feeLimitWei: '10000000000000000'
    }),
    error => error.transactionHash === keccak256(rawTransaction) && /result is unknown/.test(error.message)
  );
});
