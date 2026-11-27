import test from 'node:test';
import assert from 'node:assert/strict';
import { getMorphSwapQuote } from './bgw-swap.mjs';

const wallet = '0x2222222222222222222222222222222222222222';
const router = '0x1111111111111111111111111111111111111111';

function proxyFetch(response, calls) {
  return async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(response));
  };
}

function validProxyResponse({ value = '0', minToAmount = '2468750' } = {}) {
  return {
    provider: 'Bitget Wallet',
    quote: {
      toAmount: '2500000', minToAmount, market: 'bgwevmaggregator',
      slippage: '1.25', deadline: 300, estimateRevert: false
    },
    transaction: { to: router, data: '0x12345678', value }
  };
}

test('requests a shared-proxy quote for an ERC-20 Morph swap', async () => {
  const calls = [];
  const result = await getMorphSwapQuote({
    tokenIn: 'USDC', tokenOut: 'USDT0', amount: '2.5', slippage: '1.25', address: wallet
  }, { fetchImpl: proxyFetch(validProxyResponse(), calls) });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://morph-agent-id.pages.dev/api/swap-quote');
  assert.deepEqual(calls[0].body, {
    tokenInAddress: '0xcfb1186f4e93d60e60a8bdd997427d1f33bc372b',
    tokenOutAddress: '0xe7cd86e13ac4309349f30b3435a9d337750fc82d',
    amount: '2500000', slippage: '1.25', recipient: wallet
  });
  assert.equal(result.minimumOutput, '2.46875');
  assert.equal(result.transaction.value, '0');
});

test('uses the native-token contract and exact ETH value', async () => {
  const calls = [];
  const result = await getMorphSwapQuote({
    tokenIn: 'ETH', tokenOut: 'USDC', amount: '1', slippage: '1', address: wallet
  }, {
    fetchImpl: proxyFetch({
      ...validProxyResponse({ value: '1000000000000000000', minToAmount: '2475000' }),
      quote: { ...validProxyResponse().quote, toAmount: '2500000', minToAmount: '2475000', slippage: '1' }
    }, calls)
  });

  assert.equal(calls[0].body.tokenInAddress, '');
  assert.equal(calls[0].body.amount, '1000000000000000000');
  assert.equal(result.transaction.value, '1000000000000000000');
});

test('rejects invalid token, calldata, proxy response, and non-HTTPS proxy', async () => {
  await assert.rejects(() => getMorphSwapQuote({
    tokenIn: 'LINK', tokenOut: 'ETH', amount: '1', slippage: '1', address: wallet
  }), /supported Morph assets/);

  await assert.rejects(() => getMorphSwapQuote({
    tokenIn: 'ETH', tokenOut: 'USDC', amount: '1', slippage: '1', address: wallet
  }, { proxyUrl: 'http://example.test/swap', fetchImpl: async () => assert.fail('must not fetch') }), /must use HTTPS/);

  const calls = [];
  await assert.rejects(() => getMorphSwapQuote({
    tokenIn: 'USDC', tokenOut: 'USDT0', amount: '1', slippage: '1', address: wallet
  }, { fetchImpl: proxyFetch({ ...validProxyResponse(), transaction: { to: router, data: '0x12', value: '0' } }, calls) }), /invalid swap transaction data/);
});

test('passes proxy configuration errors without exposing credentials', async () => {
  const calls = [];
  await assert.rejects(() => getMorphSwapQuote({
    tokenIn: 'USDC', tokenOut: 'USDT0', amount: '1', slippage: '1', address: wallet
  }, {
    fetchImpl: async () => {
      calls.push(true);
      return new Response(JSON.stringify({ error: 'Bitget Wallet Swap API 凭证尚未配置。' }), { status: 503 });
    }
  }), /凭证尚未配置/);
  assert.equal(calls.length, 1);
});
