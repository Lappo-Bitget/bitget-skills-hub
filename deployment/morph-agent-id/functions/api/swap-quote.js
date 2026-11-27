const BITGET_API = 'https://bopenapi.bgwapi.io';
const QUOTE_PATH = '/bgw-pro/swapx/pro/quote';
const SWAP_PATH = '/bgw-pro/swapx/pro/swap';
const NOGAS_PRICE_PATH = '/bgw-pro/swapx/order/getSwapPrice';
const NOGAS_ORDER_PATH = '/bgw-pro/swapx/order/makeSwapOrder';
const NOGAS_SUBMIT_PATH = '/bgw-pro/swapx/order/submitSwapOrder';
const NATIVE_TOKEN = '';
const NETWORKS = Object.freeze({ morph: 2818, bsc: 56, arbitrum: 42161, ethereum: 1, polygon: 137, base: 8453 });
const NATIVE_SYMBOLS = Object.freeze({ morph: 'ETH', bsc: 'BNB', arbitrum: 'ETH', ethereum: 'ETH', polygon: 'POL', base: 'ETH' });
const ASSETS = new Map([
  [NATIVE_TOKEN, { symbol: 'ETH', decimals: 18 }],
  ['0x389c08bc23a7317000a1fd76c7c5b0cb0b4640b5', { symbol: 'BGB', decimals: 18 }],
  ['0xcfb1186f4e93d60e60a8bdd997427d1f33bc372b', { symbol: 'USDC', decimals: 6 }],
  ['0xe7cd86e13ac4309349f30b3435a9d337750fc82d', { symbol: 'USDT0', decimals: 6 }],
  ['0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', { symbol: 'USDe', decimals: 18 }],
  ['0x111111d2bf19e43c34263401e0cad979ed1cdb61', { symbol: 'USD1', decimals: 18 }],
  ['0x5300000000000000000000000000000000000011', { symbol: 'WETH', decimals: 18 }]
]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const SLIPPAGE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2}){4,65536}$/;

// Keep these payloads aligned with Bitget Wallet's generated Instruction Mode
// SDK. It does not define amountUnit or toMinAmount for these endpoints.

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function asBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signedRequest(path, body, env) {
  const timestamp = String(Date.now());
  const bodyText = JSON.stringify(body);
  const signatureContent = {
    apiPath: path,
    body: bodyText,
    'x-api-key': env.BGW_API_KEY,
    'x-api-timestamp': timestamp
  };
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.BGW_API_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalJson(signatureContent)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(BITGET_API + path, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': env.BGW_API_KEY,
        'x-api-timestamp': timestamp,
        'x-api-signature': asBase64(new Uint8Array(signature))
      },
      body: bodyText
    });
    const text = await response.text();
    if (text.length > 1048576) throw new Error('Bitget Wallet Swap API 响应过大。');
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      const detail = text.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300);
      throw new Error(`Bitget Wallet Swap API 暂不可用（HTTP ${response.status}${detail ? `，${detail}` : ''}）。`);
    }
    if (!response.ok) {
      const upstreamId = response.headers.get('x-request-id') || response.headers.get('x-bgw-request-id') || '';
      const detail = [result?.error_code ?? result?.code, result?.msg || result?.message || result?.title, result?.trace, text.slice(0, 300), upstreamId ? `request_id=${upstreamId}` : ''].filter(Boolean).join(': ');
      throw new Error(`Bitget Wallet Swap API 暂不可用（HTTP ${response.status}${detail ? `，${detail}` : ''}）。`);
    }
    if (result?.status !== 0 || !result.data || typeof result.data !== 'object') {
      const detail = [result?.error_code ?? result?.code, result?.msg || result?.message || result?.title, result?.trace, text.slice(0, 300)].filter(Boolean).join(': ');
      throw new Error(`Bitget Wallet Swap API 未返回有效结果${detail ? `（${detail}）` : ''}。`);
    }
    return result.data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Bitget Wallet Swap API 请求超时。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseSlippage(value) {
  if (typeof value !== 'string' || value.length > 5 || !SLIPPAGE.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(bps) && bps > 0 && bps <= 5000 ? bps : null;
}

function rawToHuman(raw, decimals) {
  const value = String(raw);
  if (!INTEGER.test(value)) throw new Error('Invalid raw token amount.');
  if (decimals === 0) return value;
  const padded = value.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function humanToRaw(value, decimals) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    throw new Error('Invalid human token amount.');
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Token amount exceeds precision.');
  return whole + fraction.padEnd(decimals, '0');
}

function resolveAsset(address, symbol, decimals, network) {
  const contract = String(address || '').toLowerCase();
  const tokenSymbol = String(symbol || '').trim();
  if (!contract && tokenSymbol.toUpperCase() === NATIVE_SYMBOLS[network].toUpperCase()) return { symbol: NATIVE_SYMBOLS[network], decimals: 18 };
  if (network === 'morph' && ASSETS.has(contract)) return ASSETS.get(contract);
  const parsedDecimals = Number(decimals);
  if (!ADDRESS.test(contract) || !Number.isInteger(parsedDecimals) || parsedDecimals < 0 || parsedDecimals > 36) return null;
  return { symbol: tokenSymbol || contract, decimals: parsedDecimals };
}

export async function onRequestPost({ request, env }) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== requestUrl.origin) return json(403, { error: 'Origin not allowed' });
  if (!env.BGW_API_KEY || !env.BGW_API_SECRET) {
    return json(503, { error: 'Bitget Wallet Swap API 凭证尚未配置。' });
  }

  let input;
  try {
    const text = await request.text();
    if (text.length > 4096) return json(400, { error: 'Request too large' });
    input = JSON.parse(text);
  } catch {
    return json(400, { error: 'Invalid JSON request' });
  }

  const requestedMode = String(input?.mode || 'standard');
  if (requestedMode === 'no_gas_submit') {
    const orderId = String(input?.orderId || '');
    const signedTxs = input?.signedTxs;
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(orderId) || !Array.isArray(signedTxs) || !signedTxs.length || signedTxs.length > 16 || signedTxs.some(value => typeof value !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(value))) {
      return json(400, { error: 'Invalid NoGas submission parameters' });
    }
    try {
      const submitted = await signedRequest(NOGAS_SUBMIT_PATH, { orderId, signedTxs }, env);
      return json(200, { provider: 'Bitget Wallet', mode: 'no_gas_submit', result: submitted });
    } catch (error) {
      return json(502, { stage: 'no_gas_submit', error: error?.message || 'Bitget Wallet NoGas 提交失败。' });
    }
  }

  const tokenInAddress = String(input?.tokenInAddress || '').toLowerCase();
  const tokenOutAddress = String(input?.tokenOutAddress || '').toLowerCase();
  const recipient = input?.recipient;
  const amount = input?.amount;
  const slippage = input?.slippage;
  const mode = requestedMode;
  const network = String(input?.network || '').toLowerCase();
  if (!Object.hasOwn(NETWORKS, network) || Number(input?.chainId) !== NETWORKS[network]) {
    return json(400, { error: 'Unsupported EVM network or chain ID mismatch' });
  }
  const tokenIn = resolveAsset(tokenInAddress, input?.tokenIn, input?.tokenInDecimals, network);
  const tokenOut = resolveAsset(tokenOutAddress, input?.tokenOut, input?.tokenOutDecimals, network);
  const bps = parseSlippage(slippage);
  if (!['standard', 'no_gas'].includes(mode) || !tokenIn || !tokenOut || tokenInAddress === tokenOutAddress ||
      !ADDRESS.test(recipient || '') || /^0x0{40}$/i.test(recipient || '') ||
      typeof amount !== 'string' || !INTEGER.test(amount) || amount === '0' || amount.length > 80 ||
      !bps || typeof slippage !== 'string') {
    return json(400, { error: 'Invalid swap parameters' });
  }

  const common = {
    fromChain: network,
    fromContract: tokenInAddress,
    // Bitget Wallet Instruction Mode expects human-readable amounts.
    fromAmount: rawToHuman(amount, tokenIn.decimals),
    fromAddress: recipient,
    toAddress: recipient,
    toChain: network,
    toContract: tokenOutAddress,
    // Keep quote generation independent of the current wallet balance. The
    // bridge checks the balance before any approval or execution step.
    estimateGas: false
  };

  let stage = 'quote';
  try {
    if (mode === 'no_gas') {
      const orderCommon = {
        fromChain: network,
        fromContract: tokenInAddress,
        fromAmount: rawToHuman(amount, tokenIn.decimals),
        fromAddress: recipient,
        toAddress: recipient,
        toChain: network,
        toContract: tokenOutAddress
      };
      const price = await signedRequest(NOGAS_PRICE_PATH, orderCommon, env);
      const features = Array.isArray(price.features) ? price.features.map(String) : [];
      if (!features.includes('no_gas')) {
        return json(409, { error: 'Bitget Wallet NoGas is unavailable for this pair on the selected network.', features, market: price.market || null });
      }
      if (typeof price.market !== 'string' || !price.market) {
        return json(502, { error: 'Bitget Wallet NoGas 报价缺少 market。' });
      }
      stage = 'no_gas_order';
      const order = await signedRequest(NOGAS_ORDER_PATH, {
        ...orderCommon,
        market: price.market,
        slippage: String(Number(slippage) / 100),
        feature: 'no_gas'
      }, env);
      if (typeof order.orderId !== 'string' || !order.orderId || !Array.isArray(order.signatures) || !order.signatures.length) {
        return json(502, { error: 'Bitget Wallet NoGas 返回的订单签名数据无效。' });
      }
      const signatures = order.signatures.map(item => ({ kind: item?.kind, chainName: item?.chainName, chainId: item?.chainId, hash: item?.hash, data: item?.data }));
      if (signatures.some(item => item.kind !== 'signature' || typeof item.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(item.hash) || item.data?.signType !== 'eip712')) {
        return json(502, { error: 'Bitget Wallet NoGas 返回了无法验证的 EIP-712 签名数据。' });
      }
      const estimatedOutput = price.toAmount ?? order.toAmount ?? order.toMinAmount;
      const minimumOutput = order.toMinAmount ?? price.minToAmount ?? estimatedOutput;
      if (typeof estimatedOutput !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(estimatedOutput) ||
          typeof minimumOutput !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(minimumOutput)) {
        return json(502, { error: 'Bitget Wallet NoGas 返回的数量无效。' });
      }
      const estimatedRaw = BigInt(humanToRaw(estimatedOutput, tokenOut.decimals));
      const minimumRaw = BigInt(humanToRaw(minimumOutput, tokenOut.decimals));
      if (estimatedRaw <= 0n || minimumRaw <= 0n || minimumRaw > estimatedRaw) {
        return json(502, { error: 'Bitget Wallet NoGas 返回的最小收到数量无效。' });
      }
      return json(200, { provider: 'Bitget Wallet', mode: 'no_gas', network, chainId: NETWORKS[network], quote: { toAmount: estimatedOutput, minToAmount: minimumOutput, market: price.market, slippage: String(order.slippage ?? slippage), deadline: order.signatures[0]?.data?.message?.deadline ?? 300, features }, order: { orderId: order.orderId, signatures } });
    }

    const quote = await signedRequest(QUOTE_PATH, common, env);
    if (typeof quote.toAmount !== 'string' ||
        !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(quote.toAmount) ||
        quote.toAmount === '0' || typeof quote.market !== 'string' ||
        !quote.market || quote.estimateRevert === true) {
      return json(502, { error: 'Bitget Wallet 返回了无法使用的报价。' });
    }
    const quotedAmount = BigInt(humanToRaw(String(quote.toAmount), tokenOut.decimals));
    const minAmount = (quotedAmount * BigInt(10000 - bps)) / 10000n;
    if (minAmount <= 0n) return json(502, { error: '报价的最小收到数量无效。' });

    stage = 'swap';
    const swap = await signedRequest(SWAP_PATH, {
      ...common,
      slippage: Number(slippage),
      market: quote.market,
      deadline: 300,
      requestMod: 'simple'
    }, env);
    if (!ADDRESS.test(swap.contract || '') || !HEX_DATA.test(swap.calldata || '')) {
      return json(502, { error: 'Bitget Wallet 返回的 Swap 交易数据无效。' });
    }

    return json(200, {
      provider: 'Bitget Wallet',
      network,
      chainId: NETWORKS[network],
      mode: 'standard',
      quote: {
        toAmount: quotedAmount.toString(),
        minToAmount: minAmount.toString(),
        market: quote.market,
        slippage: String(swap.slippage ?? slippage),
        deadline: swap.deadline ?? 300,
        estimateRevert: quote.estimateRevert === true
      },
      transaction: {
        to: swap.contract,
        data: swap.calldata,
        value: tokenInAddress === NATIVE_TOKEN ? amount : '0'
      }
    });
  } catch (error) {
    return json(502, { stage, error: error?.message || 'Bitget Wallet Swap API 请求失败。' });
  }
}
