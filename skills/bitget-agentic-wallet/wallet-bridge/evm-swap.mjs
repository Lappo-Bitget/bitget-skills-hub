const DEFAULT_SWAP_PROXY = 'https://morph-agent-id.pages.dev/api/swap-quote';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const SLIPPAGE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;
const CALLDATA = /^0x(?:[0-9a-fA-F]{2}){4,65536}$/;

export const EVM_NETWORKS = Object.freeze({
  morph: Object.freeze({ key: 'morph', name: 'Morph Mainnet', chainId: 2818, nativeSymbol: 'ETH' }),
  bsc: Object.freeze({ key: 'bsc', name: 'BNB Smart Chain', chainId: 56, nativeSymbol: 'BNB' }),
  arbitrum: Object.freeze({ key: 'arbitrum', name: 'Arbitrum One', chainId: 42161, nativeSymbol: 'ETH' }),
  ethereum: Object.freeze({ key: 'ethereum', name: 'Ethereum Mainnet', chainId: 1, nativeSymbol: 'ETH' }),
  polygon: Object.freeze({ key: 'polygon', name: 'Polygon PoS', chainId: 137, nativeSymbol: 'POL' }),
  base: Object.freeze({ key: 'base', name: 'Base', chainId: 8453, nativeSymbol: 'ETH' })
});

const MORPH_ASSETS = Object.freeze({
  ETH: Object.freeze({ contract: '', decimals: 18 }),
  BGB: Object.freeze({ contract: '0x389c08bc23a7317000a1fd76c7c5b0cb0b4640b5', decimals: 18 }),
  USDC: Object.freeze({ contract: '0xcfb1186f4e93d60e60a8bdd997427d1f33bc372b', decimals: 6 }),
  USDT0: Object.freeze({ contract: '0xe7cd86e13ac4309349f30b3435a9d337750fc82d', decimals: 6 }),
  USDe: Object.freeze({ contract: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', decimals: 18 }),
  USD1: Object.freeze({ contract: '0x111111d2bf19e43c34263401e0cad979ed1cdb61', decimals: 18 }),
  WETH: Object.freeze({ contract: '0x5300000000000000000000000000000000000011', decimals: 18 })
});

function networkInfo(network) {
  const result = EVM_NETWORKS[String(network || '').toLowerCase()];
  if (!result) throw new Error('Select one supported EVM network: BSC, Arbitrum One, Ethereum Mainnet, Polygon PoS, Base, or Morph Mainnet.');
  return result;
}

function assetInfo(network, symbol, contract, decimals) {
  const name = String(symbol || '').trim();
  const address = typeof contract === 'string' ? contract.toLowerCase() : '';
  if (address && !ADDRESS.test(address)) throw new Error('Token contract address is invalid.');
  if (!address && name.toUpperCase() === network.nativeSymbol.toUpperCase()) return { symbol: name || network.nativeSymbol, contract: '', decimals: 18 };
  if (!address && network.key === 'morph' && MORPH_ASSETS[name]) return { symbol: name, ...MORPH_ASSETS[name] };
  const parsedDecimals = decimals === undefined || decimals === null ? NaN : Number(decimals);
  if (!address || !Number.isInteger(parsedDecimals) || parsedDecimals < 0 || parsedDecimals > 36) {
    throw new Error('For this network, provide the ERC-20 token contract and decimals.');
  }
  return { symbol: name || address, contract: address, decimals: parsedDecimals };
}

function rawAmount(asset, amount) {
  if (typeof amount !== 'string' || !DECIMAL.test(amount)) throw new Error('amount must be a positive decimal string.');
  const parts = amount.split('.');
  const fraction = parts[1] || '';
  if (fraction.length > asset.decimals) throw new Error('amount exceeds the token precision.');
  const raw = BigInt(parts[0] + fraction.padEnd(asset.decimals, '0'));
  if (raw <= 0n) throw new Error('amount must be greater than zero.');
  return raw.toString();
}

function formatAmount(raw, decimals) {
  if (typeof raw !== 'string' || !UINT.test(raw)) throw new Error('Bitget Wallet returned an invalid token amount.');
  const digits = raw.padStart(decimals + 1, '0');
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '') : '';
  return fraction ? whole + '.' + fraction : whole;
}

function decimalRaw(value, decimals) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return null;
  const parts = value.split('.');
  if ((parts[1] || '').length > decimals) return null;
  return BigInt(parts[0] + (parts[1] || '').padEnd(decimals, '0'));
}

function validateSlippage(value) {
  if (typeof value !== 'string' || value.length > 5 || !SLIPPAGE.test(value)) throw new Error('slippage must be a decimal percentage with at most two decimal places.');
  const parts = value.split('.');
  const bps = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(bps) || bps <= 0 || bps > 5000) throw new Error('slippage must be greater than 0 and no more than 50 percent.');
  return bps;
}

async function requestProxy(body, proxyUrl, fetchImpl) {
  const parsed = new URL(proxyUrl);
  if (parsed.protocol !== 'https:') throw new Error('BGW_SWAP_PROXY_URL must use HTTPS.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(parsed.toString(), { method: 'POST', redirect: 'error', signal: controller.signal, headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { throw new Error('Bitget Wallet Swap proxy returned invalid JSON.'); }
    if (!response.ok) throw new Error(result?.error || ('Bitget Wallet Swap proxy returned HTTP ' + response.status + '.'));
    const valid = result?.provider === 'Bitget Wallet' && (result.mode === 'no_gas_submit' ? result.result : result.mode === 'no_gas' ? result.quote && result.order : result.quote && result.transaction);
    if (!valid) throw new Error('Bitget Wallet Swap proxy returned an invalid response.');
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Bitget Wallet Swap request timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getSwapQuote({ network = 'bsc', tokenIn, tokenOut, tokenInAddress = '', tokenOutAddress = '', tokenInDecimals, tokenOutDecimals, amount, slippage, address }, { proxyUrl = process.env.BGW_SWAP_PROXY_URL || DEFAULT_SWAP_PROXY, fetchImpl = globalThis.fetch } = {}) {
  const chain = networkInfo(network);
  const input = assetInfo(chain, tokenIn, tokenInAddress, tokenInDecimals);
  const output = assetInfo(chain, tokenOut, tokenOutAddress, tokenOutDecimals);
  if (input.contract === output.contract && input.symbol === output.symbol) throw new Error('Select two different tokens.');
  if (!ADDRESS.test(address || '') || /^0x0{40}$/i.test(address)) throw new Error('Connected wallet address is invalid.');
  validateSlippage(slippage);
  const amountRaw = rawAmount(input, amount);
  const response = await requestProxy({ mode: 'standard', network: chain.key, chainId: chain.chainId, tokenIn: input.symbol, tokenOut: output.symbol, tokenInAddress: input.contract, tokenOutAddress: output.contract, tokenInDecimals: input.decimals, tokenOutDecimals: output.decimals, amount: amountRaw, slippage, recipient: address }, proxyUrl, fetchImpl);
  const quote = response.quote;
  const transaction = response.transaction;
  if (quote.estimateRevert === true || typeof quote.market !== 'string' || !quote.market || typeof quote.toAmount !== 'string' || !UINT.test(quote.toAmount) || quote.toAmount === '0' || typeof quote.minToAmount !== 'string' || !UINT.test(quote.minToAmount) || BigInt(quote.minToAmount) <= 0n || BigInt(quote.minToAmount) > BigInt(quote.toAmount)) throw new Error('Bitget Wallet returned a quote that cannot be used safely.');
  if (!ADDRESS.test(transaction.to || '') || !CALLDATA.test(transaction.data || '') || typeof transaction.value !== 'string' || !UINT.test(transaction.value) || transaction.value !== (input.contract === '' ? amountRaw : '0')) throw new Error('Bitget Wallet returned invalid swap transaction data.');
  return { provider: 'Bitget Wallet Swap API via shared proxy', network: chain.name, networkKey: chain.key, chainId: chain.chainId, tokenIn: input.symbol, tokenOut: output.symbol, tokenInAddress: input.contract, tokenOutAddress: output.contract, tokenInDecimals: input.decimals, tokenOutDecimals: output.decimals, amount, estimatedOutput: formatAmount(quote.toAmount, output.decimals), minimumOutput: formatAmount(quote.minToAmount, output.decimals), slippage: String(quote.slippage ?? slippage), market: quote.market, expiresInSeconds: Number(quote.deadline ?? 300), transaction: { to: transaction.to, data: transaction.data, value: transaction.value } };
}

export async function getNoGasOrder({ network = 'bsc', tokenIn, tokenOut, tokenInAddress = '', tokenOutAddress = '', tokenInDecimals, tokenOutDecimals, amount, slippage, address }, { proxyUrl = process.env.BGW_SWAP_PROXY_URL || DEFAULT_SWAP_PROXY, fetchImpl = globalThis.fetch } = {}) {
  const chain = networkInfo(network);
  const input = assetInfo(chain, tokenIn, tokenInAddress, tokenInDecimals);
  const output = assetInfo(chain, tokenOut, tokenOutAddress, tokenOutDecimals);
  if (input.contract === output.contract && input.symbol === output.symbol) throw new Error('Select two different tokens.');
  if (!ADDRESS.test(address || '') || /^0x0{40}$/i.test(address)) throw new Error('Connected wallet address is invalid.');
  validateSlippage(slippage);
  const amountRaw = rawAmount(input, amount);
  const response = await requestProxy({ mode: 'no_gas', network: chain.key, chainId: chain.chainId, tokenIn: input.symbol, tokenOut: output.symbol, tokenInAddress: input.contract, tokenOutAddress: output.contract, tokenInDecimals: input.decimals, tokenOutDecimals: output.decimals, amount: amountRaw, slippage: (Number(slippage) / 100).toString(), recipient: address }, proxyUrl, fetchImpl);
  if (response.mode !== 'no_gas' || !response.order || !Array.isArray(response.order.signatures)) throw new Error('Bitget Wallet NoGas returned an invalid order.');
  const features = Array.isArray(response.quote?.features) ? response.quote.features.map(String) : [];
  if (!features.includes('no_gas')) throw new Error('Bitget Wallet NoGas is not available for this swap.');
  const estimatedRaw = decimalRaw(response.quote.toAmount, output.decimals);
  const minimumRaw = decimalRaw(response.quote.minToAmount, output.decimals);
  if (estimatedRaw === null || estimatedRaw <= 0n || minimumRaw === null || minimumRaw <= 0n || minimumRaw > estimatedRaw || typeof response.quote.market !== 'string' || !response.quote.market) throw new Error('Bitget Wallet returned an invalid NoGas quote.');
  for (const signature of response.order.signatures) {
    const signatureChainId = Number(signature?.chainId ?? signature?.data?.domain?.chainId);
    const message = signature?.data?.message;
    if (signature?.kind !== 'signature' || typeof signature.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(signature.hash) || signature.data?.signType !== 'eip712' || (Number.isFinite(signatureChainId) && signatureChainId !== chain.chainId) || typeof message?.msgSender !== 'string' || message.msgSender.toLowerCase() !== address.toLowerCase()) throw new Error('Bitget Wallet returned an invalid NoGas EIP-712 signature request.');
  }
  const signatureDeadline = Number(response.order.signatures[0]?.data?.message?.deadline);
  const expiresInSeconds = Number.isSafeInteger(signatureDeadline) ? Math.max(0, signatureDeadline - Math.floor(Date.now() / 1000)) : 300;
  if (expiresInSeconds <= 0) throw new Error('Bitget Wallet NoGas order has expired. Request a new order.');
  return { provider: 'Bitget Wallet NoGas Order Mode', mode: 'no_gas', network: chain.name, networkKey: chain.key, chainId: chain.chainId, tokenIn: input.symbol, tokenOut: output.symbol, tokenInAddress: input.contract, tokenOutAddress: output.contract, tokenInDecimals: input.decimals, tokenOutDecimals: output.decimals, amount, estimatedOutput: response.quote.toAmount, minimumOutput: response.quote.minToAmount, slippage: String(response.quote.slippage ?? slippage), market: response.quote.market, expiresInSeconds, features, orderId: response.order.orderId, signatures: response.order.signatures };
}

export async function submitNoGasOrder({ orderId, signedTxs }, { proxyUrl = process.env.BGW_SWAP_PROXY_URL || DEFAULT_SWAP_PROXY, fetchImpl = globalThis.fetch } = {}) {
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(orderId)) throw new Error('Bitget Wallet NoGas order ID is invalid.');
  if (!Array.isArray(signedTxs) || !signedTxs.length || signedTxs.length > 16 || signedTxs.some(value => typeof value !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(value))) throw new Error('Bitget Wallet NoGas signatures are invalid.');
  const response = await requestProxy({ mode: 'no_gas_submit', orderId, signedTxs }, proxyUrl, fetchImpl);
  if (response.mode !== 'no_gas_submit' || !response.result) throw new Error('Bitget Wallet NoGas submission returned an invalid response.');
  return response.result;
}
