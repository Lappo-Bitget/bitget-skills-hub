const DEFAULT_SWAP_PROXY = 'https://morph-agent-id.pages.dev/api/swap-quote';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const SLIPPAGE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;
const CALLDATA = /^0x(?:[0-9a-fA-F]{2}){4,65536}$/;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const MORPH_ASSETS = Object.freeze({
  ETH: Object.freeze({ contract: '', decimals: 18 }),
  BGB: Object.freeze({ contract: '0x389c08bc23a7317000a1fd76c7c5b0cb0b4640b5', decimals: 18 }),
  USDC: Object.freeze({ contract: '0xcfb1186f4e93d60e60a8bdd997427d1f33bc372b', decimals: 6 }),
  USDT0: Object.freeze({ contract: '0xe7cd86e13ac4309349f30b3435a9d337750fc82d', decimals: 6 }),
  USDe: Object.freeze({ contract: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', decimals: 18 }),
  USD1: Object.freeze({ contract: '0x111111d2bf19e43c34263401e0cad979ed1cdb61', decimals: 18 }),
  WETH: Object.freeze({ contract: '0x5300000000000000000000000000000000000011', decimals: 18 })
});

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

async function requestProxy(body, proxyUrl, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(proxyUrl, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text();
      let message = `Bitget Wallet Swap proxy returned HTTP ${response.status}.`;
      try { message = JSON.parse(text)?.error || message; } catch { /* use status message */ }
      throw new Error(message);
    }
    const responseText = await response.text();
    if (responseText.length > 1048576) throw new Error('Bitget Wallet Swap response exceeded 1 MiB.');
    const result = JSON.parse(responseText);
    if (result?.provider !== 'Bitget Wallet' || !result.quote || !result.transaction) {
      throw new Error('Bitget Wallet Swap proxy returned an invalid response.');
    }
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Bitget Wallet Swap request timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getMorphSwapQuote({ tokenIn, tokenOut, amount, slippage, address }, {
  proxyUrl = process.env.BGW_SWAP_PROXY_URL || DEFAULT_SWAP_PROXY,
  fetchImpl = globalThis.fetch
} = {}) {
  const input = MORPH_ASSETS[tokenIn];
  const output = MORPH_ASSETS[tokenOut];
  if (!input || !output || tokenIn === tokenOut) throw new Error('Select two different supported Morph assets.');
  if (!ADDRESS.test(address || '') || /^0x0{40}$/i.test(address)) throw new Error('Connected Morph wallet address is invalid.');
  validateSlippage(slippage);
  const amountWei = rawAmount(input, amount);
  let parsedProxy;
  try { parsedProxy = new URL(proxyUrl); } catch { throw new Error('BGW_SWAP_PROXY_URL must be a valid HTTPS URL.'); }
  if (parsedProxy.protocol !== 'https:') throw new Error('BGW_SWAP_PROXY_URL must use HTTPS.');

  const response = await requestProxy({
    tokenInAddress: input.contract,
    tokenOutAddress: output.contract,
    amount: amountWei,
    slippage,
    recipient: address
  }, parsedProxy.toString(), fetchImpl);
  const quote = response.quote;
  const transaction = response.transaction;
  if (quote.estimateRevert === true || typeof quote.market !== 'string' || !quote.market ||
      typeof quote.toAmount !== 'string' || !UINT.test(quote.toAmount) || quote.toAmount === '0' ||
      typeof quote.minToAmount !== 'string' || !UINT.test(quote.minToAmount) ||
      BigInt(quote.minToAmount) <= 0n || BigInt(quote.minToAmount) > BigInt(quote.toAmount)) {
    throw new Error('Bitget Wallet returned a quote that cannot be used safely.');
  }
  if (!HEX_ADDRESS.test(transaction.to || '') || !CALLDATA.test(transaction.data || '') ||
      typeof transaction.value !== 'string' || !UINT.test(transaction.value) ||
      transaction.value !== (input.contract === '' ? amountWei : '0')) {
    throw new Error('Bitget Wallet returned invalid swap transaction data.');
  }

  return {
    provider: 'Bitget Wallet Swap API via shared proxy',
    network: 'Morph Mainnet',
    chainId: 2818,
    tokenIn,
    tokenOut,
    amount,
    estimatedOutput: formatAmount(quote.toAmount, output.decimals),
    minimumOutput: formatAmount(quote.minToAmount, output.decimals),
    slippage: String(quote.slippage ?? slippage),
    market: quote.market,
    expiresInSeconds: Number(quote.deadline ?? 300),
    transaction: {
      to: transaction.to,
      data: transaction.data,
      value: transaction.value
    }
  };
}
