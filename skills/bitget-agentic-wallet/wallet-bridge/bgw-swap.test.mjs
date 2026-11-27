import test from 'node:test';
import assert from 'node:assert/strict';
import { getMorphSwapQuote, getMorphNoGasOrder, submitMorphNoGasOrder } from './bgw-swap.mjs';

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

function validNoGasResponse() {
  return {
    provider: 'Bitget Wallet',
    mode: 'no_gas',
    quote: { toAmount: '9.8', minToAmount: '9.7', market: 'bgwevmaggregator', slippage: '1', features: ['no_gas'] },
    order: {
      orderId: '316de20899804b75a4e88f9bfd8468f3',
      signatures: [{
        kind: 'signature', chainName: 'morph', chainId: '2818',
        hash: `0x${'11'.repeat(32)}`,
        data: { signType: 'eip712', types: {}, domain: { chainId: '2818' }, message: { chainId: '2818', msgSender: wallet, deadline: String(Math.floor(Date.now() / 1000) + 300) } }
      }]
    }
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

test('prepares an official Bitget Wallet NoGas order', async () => {
  const calls = [];
  const result = await getMorphNoGasOrder({
    tokenIn: 'USDC', tokenOut: 'USDT0', amount: '10', slippage: '1', address: wallet
  }, { fetchImpl: proxyFetch(validNoGasResponse(), calls) });
  assert.equal(calls[0].body.mode, 'no_gas');
  assert.equal(calls[0].body.slippage, '0.01');
  assert.equal(result.mode, 'no_gas');
  assert.equal(result.features.includes('no_gas'), true);
  assert.equal(result.orderId, '316de20899804b75a4e88f9bfd8468f3');
});

test('submits NoGas signatures through the shared proxy', async () => {
  const calls = [];
  const signed = `0x${'22'.repeat(65)}`;
  const response = { provider: 'Bitget Wallet', mode: 'no_gas_submit', result: { orderId: '316de20899804b75a4e88f9bfd8468f3', status: 'submitted' } };
  const result = await submitMorphNoGasOrder({ orderId: '316de20899804b75a4e88f9bfd8468f3', signedTxs: [signed] }, { fetchImpl: proxyFetch(response, calls) });
  assert.equal(calls[0].body.mode, 'no_gas_submit');
  assert.deepEqual(result, response.result);
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
