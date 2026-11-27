import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getNetwork,
  networkForChainId,
  NETWORK_CHAIN_IDS,
  NETWORK_RPC_MAP,
  supportedNetworkSummary
} from './networks.mjs';

test('lists the supported wallet EVM networks and their chain IDs', () => {
  assert.deepEqual(NETWORK_CHAIN_IDS, [2818, 56, 42161, 1, 137, 8453]);
  assert.equal(supportedNetworkSummary().length, 6);
  assert.equal(getNetwork('bsc').nativeSymbol, 'BNB');
  assert.equal(getNetwork('polygon').nativeSymbol, 'POL');
});

test('maps chain IDs to networks and keeps RPC entries aligned', () => {
  assert.equal(networkForChainId(42161).key, 'arbitrum');
  assert.equal(networkForChainId(8453).name, 'Base');
  assert.equal(networkForChainId(10), null);
  assert.deepEqual(Object.keys(NETWORK_RPC_MAP).map(Number).sort((a, b) => a - b), [...NETWORK_CHAIN_IDS].sort((a, b) => a - b));
});
