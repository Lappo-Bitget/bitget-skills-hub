import test from 'node:test';
import assert from 'node:assert/strict';
import { getMorphSwapQuote } from './bgw-swap.mjs';

const wallet = '0x2222222222222222222222222222222222222222';
const router = '0x1111111111111111111111111111111111111111';

function apiFetch(responses, calls) {
  return async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    const response = responses.shift();
    return new Response(JSON.stringify({ status: 0, data: response }));
  };
}

test('requests a Bitget quote and calldata for an ERC-20 Morph swap', async () => {
  const calls = [];
  const result = await getMorphSwapQuote({
    tokenIn: 'USDC', tokenOut: 'USDT0', amount: '2.5', slippage: '1.25', address: wallet
  }, {
    apiKey: 'test-key', apiSecret: 'test-secret',
    fetchImpl: apiFetch([
      { toAmount: '2500000', market: 'bgwevmaggregator', estimateRevert: false },
      { contract: router, calldata: '0x12345678', minToAmount: '2468750', slippage: '1.25', deadline: 300 }
    ], calls)
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://bopenapi.bgwapi.io/bgw-pro/swapx/pro/quote');
  assert.equal(calls[0].body.fromChain, 'morph');
  assert.equal(calls[0].body.fromAmount, '2500000');
  assert.equal(calls[0].body.amountUnit, 'wei');
  assert.equal(calls[0].body.fromAddress, wallet);
  assert.equal(calls[1].url, 'https://bopenapi.bgwapi.io/bgw-pro/swapx/pro/swap');
  assert.equal(calls[1].body.toMinAmount, '2468750');
  assert.equal(calls[1].body.market, 'bgwevmaggregator');
  assert.equal(result.minimumOutput, '2.46875');
  assert.equal(result.transaction.value, '0');
});

test('uses an empty native-token contract and attaches the exact ETH input value', async () => {
  const calls = [];
  const result = await getMorphSwapQuote({
    tokenIn: 'ETH', tokenOut: 'USDC', amount: '1', slippage: '1', address: wallet
  }, {
    apiKey: 'test-key', apiSecret: 'test-secret',
    fetchImpl: apiFetch([
      { toAmount: '1000000', market: 'bgwevmaggregator', estimateRevert: false },
      { contract: router, calldata: '0x12345678', minToAmount: '990000', slippage: '1', deadline: 300 }
    ], calls)
  });

  assert.equal(calls[0].body.fromContract, '');
  assert.equal(calls[0].body.fromAmount, '1000000000000000000');
  assert.equal(result.transaction.value, '1000000000000000000');
});

test('rejects missing credentials before making a network request', async () => {
  let called = false;
  await assert.rejects(() => getMorphSwapQuote({
    tokenIn: 'ETH', tokenOut: 'USDC', amount: '1', slippage: '1', address: wallet
  }, { apiKey: '', apiSecret: '', fetchImpl: async () => { called = true; } }), /Set BGW_API_KEY/);
  assert.equal(called, false);
});

test('rejects unsupported tokens and malformed router calldata', async () => {
  await assert.rejects(() => getMorphSwapQuote({
    tokenIn: 'LINK', tokenOut: 'ETH', amount: '1', slippage: '1', address: wallet
  }, { apiKey: 'key', apiSecret: 'secret' }), /supported Morph assets/);

  const calls = [];
  await assert.rejects(() => getMorphSwapQuote({
    tokenIn: 'ETH', tokenOut: 'USDC', amount: '1', slippage: '1', address: wallet
  }, {
    apiKey: 'key', apiSecret: 'secret',
    fetchImpl: apiFetch([
      { toAmount: '1000000', market: 'bgwevmaggregator', estimateRevert: false },
      { contract: router, calldata: '0x12', minToAmount: '990000' }
    ], calls)
  }), /invalid swap transaction data/);
});
