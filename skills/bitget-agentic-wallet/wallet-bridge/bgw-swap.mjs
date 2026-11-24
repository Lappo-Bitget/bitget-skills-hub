import { createHmac } from 'node:crypto';

const API_BASE = 'https://bopenapi.bgwapi.io';
const QUOTE_PATH = '/bgw-pro/swapx/pro/quote';
const SWAP_PATH = '/bgw-pro/swapx/pro/swap';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const SLIPPAGE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;
const CALLDATA = /^0x(?:[0-9a-fA-F]{2}){4,65536}$/;

export const MORPH_ASSETS = Object.freeze({
  ETH: Object.freeze({ contract: '', decimals: 18 }),
  BGB: Object.freeze({ contract: '0x389c08bc23a7317000a1fd76c7c5b0cb0b4640b5', decimals: 18 }),
  USDC: Object.freeze({ contract: '0xcfb1186f4e93d60e60a8bdd997427d1f33bc372b', decimals: 6 }),
  USDT0: Object.freeze({ contract: '0xe7cd86e13ac4309349f30b3435a9d337750fc82d', decimals: 6 }),
  USDe: Object.freeze({ contract: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', decimals: 18 }),
  USD1: Object.freeze({ contract: '0x111111d2bf19e43c34263401e0cad979ed1cdb61', decimals: 18 }),
  WETH: Object.freeze({ contract: '0x5300000000000000000000000000000000000011', decimals: 18 })
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function rawAmount(asset, amount) {
  if (typeof amount !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount)) {
    throw new Error('amount must be a positive decimal string.');
  }
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > asset.decimals || BigInt(whole + fraction.padEnd(asset.decimals, '0')) <= 0n) {
    throw new Error('amount is outside the token precision or range.');
  }
  return BigInt(whole + fraction.padEnd(asset.decimals, '0')).toString();
}

function formatAmount(raw, decimals) {
  if (typeof raw !== 'string' || !UINT.test(raw)) throw new Error('Bitget Wallet returned an invalid token amount.');
  const digits = raw.padStart(decimals + 1, '0');
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}

function validateSlippage(value) {
  if (typeof value !== 'string' || value.length > 5 || !SLIPPAGE.test(value)) {
    throw new Error('slippage must be a decimal percentage with at most two decimal places.');
  }
  const [whole, fraction = ''] = value.split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(bps) || bps <= 0 || bps > 5000) {
    throw new Error('slippage must be greater than 0 and no more than 50 percent.');
  }
  return bps;
}

async function signedPost(path, body, credentials, fetchImpl) {
  const timestamp = String(Date.now());
  const bodyText = JSON.stringify(body);
  const signedContent = canonicalJson({
    apiPath: path,
    body: bodyText,
    'x-api-key': credentials.apiKey,
    'x-api-timestamp': timestamp
  });
  const signature = createHmac('sha256', credentials.apiSecret).update(signedContent).digest('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': credentials.apiKey,
        'x-api-timestamp': timestamp,
        'x-api-signature': signature
      },
      body: bodyText
    });
    if (!response.ok) throw new Error(`Bitget Wallet Swap API returned HTTP ${response.status}.`);
    const responseText = await response.text();
    if (responseText.length > 1048576) throw new Error('Bitget Wallet Swap API response exceeded 1 MiB.');
    const result = JSON.parse(responseText);
    if (result?.status !== 0 || !result.data || typeof result.data !== 'object') {
      throw new Error(result?.msg || result?.message || 'Bitget Wallet Swap API returned an invalid response.');
    }
    return result.data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Bitget Wallet Swap API request timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getMorphSwapQuote({ tokenIn, tokenOut, amount, slippage, address }, {
  apiKey = process.env.BGW_API_KEY,
  apiSecret = process.env.BGW_API_SECRET,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!apiKey || !apiSecret) {
    throw new Error('Set BGW_API_KEY and BGW_API_SECRET in the local Bitget Wallet MCP server environment.');
  }
  const input = MORPH_ASSETS[tokenIn];
  const output = MORPH_ASSETS[tokenOut];
  if (!input || !output || tokenIn === tokenOut) throw new Error('Select two different supported Morph assets.');
  if (!ADDRESS.test(address || '') || /^0x0{40}$/i.test(address)) throw new Error('Connected Morph wallet address is invalid.');
  const bps = validateSlippage(slippage);
  const amountWei = rawAmount(input, amount);
  const common = {
    fromChain: 'morph',
    fromContract: input.contract,
    fromAmount: amountWei,
    amountUnit: 'wei',
    fromAddress: address,
    toAddress: address,
    toChain: 'morph',
    toContract: output.contract,
    estimateGas: true
  };

  const quote = await signedPost(QUOTE_PATH, common, { apiKey, apiSecret }, fetchImpl);
  if (quote.estimateRevert === true || typeof quote.market !== 'string' || !quote.market ||
      typeof quote.toAmount !== 'string' || !UINT.test(quote.toAmount) || quote.toAmount === '0') {
    throw new Error('Bitget Wallet returned a quote that cannot be used safely.');
  }
  const minimum = BigInt(quote.toAmount) * BigInt(10000 - bps) / 10000n;
  if (minimum <= 0n) throw new Error('Calculated minimum output is invalid.');

  const swap = await signedPost(SWAP_PATH, {
    ...common,
    toMinAmount: minimum.toString(),
    slippage: Number(slippage),
    market: quote.market,
    deadline: 300,
    requestMod: 'simple'
  }, { apiKey, apiSecret }, fetchImpl);
  if (!ADDRESS.test(swap.contract || '') || !CALLDATA.test(swap.calldata || '') ||
      typeof swap.minToAmount !== 'string' || !UINT.test(swap.minToAmount) ||
      BigInt(swap.minToAmount) < minimum || BigInt(swap.minToAmount) > BigInt(quote.toAmount)) {
    throw new Error('Bitget Wallet returned invalid swap transaction data.');
  }

  return {
    provider: 'Bitget Wallet Swap API',
    network: 'Morph Mainnet',
    chainId: 2818,
    tokenIn,
    tokenOut,
    amount,
    estimatedOutput: formatAmount(quote.toAmount, output.decimals),
    minimumOutput: formatAmount(swap.minToAmount, output.decimals),
    slippage: String(swap.slippage ?? slippage),
    market: quote.market,
    expiresInSeconds: Number(swap.deadline ?? 300),
    transaction: {
      to: swap.contract,
      data: swap.calldata,
      value: input.contract === '' ? amountWei : '0'
    }
  };
}
