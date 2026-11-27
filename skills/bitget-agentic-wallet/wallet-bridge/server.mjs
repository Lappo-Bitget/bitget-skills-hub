import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import QRCode from 'qrcode';
import { z } from 'zod';
import Ws from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { resolveWalletConnectProxy } from './proxy.mjs';
import { getSwapQuote as getNetworkSwapQuote, getNoGasOrder, submitNoGasOrder } from './evm-swap.mjs';
import { randomUUID } from 'node:crypto';
import { getNetwork, networkForChainId, NETWORK_CHAIN_IDS, NETWORK_KEYS, NETWORK_RPC_MAP, supportedNetworkSummary } from './networks.mjs';

// Keep WalletConnect usable for users with direct internet access. If the
// environment supplies a proxy, route only WalletConnect's WebSocket relay
// through it; never assume a machine-specific localhost proxy is present.
const proxyUrl = resolveWalletConnectProxy();
if (proxyUrl) {
  const parsedProxy = new URL(proxyUrl);
  if (!['http:', 'https:'].includes(parsedProxy.protocol)) {
    throw new Error('WalletConnect proxy must use an http:// or https:// URL.');
  }
  const proxyAgent = new HttpsProxyAgent(parsedProxy);
  globalThis.WebSocket = class ProxiedWebSocket extends Ws {
    constructor(url, protocols, options = {}) {
      super(url, protocols, { ...options, agent: proxyAgent });
    }
  };
}
const { EthereumProvider } = await import('@walletconnect/ethereum-provider');

const DEFAULT_NETWORK_KEY = 'bsc';

const PROJECT_ID = process.env.WALLETCONNECT_PROJECT_ID || '8c4660c0aeaeebdec859180fb6679463';
const DAPP_URL = 'https://morph-agent-id.pages.dev/';
const QR_FILE = fileURLToPath(new URL('./walletconnect-qr.png', import.meta.url));
const BRIDGE_DIR = dirname(fileURLToPath(import.meta.url));
const LOCAL_WALLET_CMD = resolve(BRIDGE_DIR, '..', 'scripts', 'configure-local-wallet.cmd');
let provider = null;
let selectedNetworkKey = DEFAULT_NETWORK_KEY;
let pairingPromise = null;
let pairingQr = null;
let pairingUri = null;
let pairingQrPath = null;
let walletMode = 'light';
let localWalletConfiguratorStarted = false;
const pendingSwapQuotes = new Map();
const swapAuthorizations = new Map();
try { await unlink(QR_FILE); } catch { /* remove a stale QR from a previous bridge process */ }

const server = new McpServer({ name: 'bitget-agentic-wallet', version: '0.1.0' });

function textResult(text, image) {
  return {
    content: [
      // Put the QR image first. Some MCP clients render only the first content
      // block, so returning text first can make a valid pairing appear QR-less.
      ...(image ? [{ type: 'image', data: image.toString('base64'), mimeType: 'image/png' }] : []),
      { type: 'text', text }
    ]
  };
}
function pairingText(text) {
  const fallback = pairingQrPath
    ? `\n\nQR PNG fallback (absolute path): ${pairingQrPath}\nIf your client does not render the image block, embed that local PNG in the response.`
    : '';
  return `${text}${fallback}`;
}
function requireProvider() {
  if (!provider) throw new Error('No WalletConnect session. Call connect_wallet first and scan its QR in Bitget Wallet.');
  return provider;
}

function openLocalWalletConfigurator() {
  if (process.platform !== 'win32') {
    return { opened: false, reason: 'windows_only' };
  }
  if (!existsSync(LOCAL_WALLET_CMD)) {
    return { opened: false, reason: 'script_not_found', path: LOCAL_WALLET_CMD };
  }

  const child = spawn(LOCAL_WALLET_CMD, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    shell: true
  });
  child.once('error', () => {});
  child.unref();
  return { opened: true, path: LOCAL_WALLET_CMD };
}

async function connectedAccount() {
  const p = requireProvider();
  const accounts = await p.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts) || !accounts.length) throw new Error('WalletConnect session is not approved. Reconnect with Bitget Wallet.');
  const chainId = Number(BigInt(await p.request({ method: 'eth_chainId' })));
  const network = networkForChainId(chainId);
  if (!network) throw new Error(`Unsupported EVM network (chain ID ${chainId}). Select BSC, Arbitrum One, Ethereum Mainnet, Polygon PoS, Base, or Morph Mainnet.`);
  selectedNetworkKey = network.key;
  return { p, address: accounts[0], chainId, network };
}

async function morphDeploymentAccount() {
  const status = await connectedAccount();
  if (status.chainId !== 2818) {
    throw new Error(`This operation is available on Morph Mainnet only. Switch the connected wallet from ${status.network.name} to Morph Mainnet first.`);
  }
  return status;
}

server.registerTool('connect_wallet', {
  title: 'Connect Bitget Wallet on an EVM network',
  description: 'Create one WalletConnect pairing QR whose single approval covers Morph Mainnet, BNB Smart Chain, Arbitrum One, Ethereum Mainnet, Polygon PoS, and Base. The network argument only selects the initial active chain.',
  inputSchema: { network: z.enum(NETWORK_KEYS).default(DEFAULT_NETWORK_KEY) }
}, async ({ network: networkKey }) => {
  const targetNetwork = getNetwork(networkKey);
  selectedNetworkKey = networkKey;
  if (!provider) {
    provider = await EthereumProvider.init({
      projectId: PROJECT_ID,
      chains: NETWORK_CHAIN_IDS,
      methods: ['eth_sendTransaction', 'eth_sign'],
      optionalMethods: ['wallet_switchEthereumChain', 'wallet_addEthereumChain'],
      showQrModal: false,
      rpcMap: NETWORK_RPC_MAP,
      metadata: {
        name: 'Bitget Agentic Wallet · EVM',
        description: 'User-controlled Bitget Wallet connection for supported EVM networks',
        url: DAPP_URL,
        icons: []
      }
    });
  }
  try {
    const status = await connectedAccount();
    if (status.network.key === networkKey) {
      return textResult(`Already connected: ${status.address} on ${status.network.name}.`);
    }
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${targetNetwork.chainId.toString(16)}` }] });
    const switched = await connectedAccount();
    if (switched.network.key !== networkKey) throw new Error(`Wallet did not switch to ${targetNetwork.name}.`);
    return textResult(`Already connected: ${switched.address} on ${targetNetwork.name}.`);
  } catch (error) {
    if (provider?.session && !/not approved|No WalletConnect session/i.test(error?.message || '')) throw error;
  }

  if (pairingPromise) {
    const uriText = pairingUri ? `\n\nWalletConnect URI (备用，可复制到 Bitget Wallet)：\n${pairingUri}` : '';
    return textResult(pairingText(`A WalletConnect pairing is already pending for ${targetNetwork.name}. Scan this QR with Bitget Wallet.${uriText}`), pairingQr);
  }
  let resolveUri; let rejectUri; let timer;
  const uriReady = new Promise((resolve, reject) => { resolveUri = resolve; rejectUri = reject; });
  const onUri = uri => { if (uri) resolveUri(uri); };
  provider.on('display_uri', onUri);
  pairingPromise = provider.connect().catch(error => { rejectUri(error); throw error; });
  // Clear the pending marker once the session is approved (or fails), while
  // leaving the generated QR available for retries during the scan window.
  pairingPromise.then(() => { pairingPromise = null; }, () => { pairingPromise = null; });
  try {
    const uri = await Promise.race([uriReady, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('WalletConnect did not produce a pairing QR within 30 seconds.')), 30000); })]);
    const qr = await QRCode.toBuffer(uri, { type: 'png', width: 1024, margin: 4, errorCorrectionLevel: 'H' });
    pairingUri = uri;
    pairingQr = qr;
    try {
      await writeFile(QR_FILE, qr);
      pairingQrPath = QR_FILE;
    } catch {
      pairingQrPath = null;
    }
    return textResult(pairingText(`Scan this high-resolution QR with Bitget Wallet. Approve one WalletConnect request covering all supported EVM networks: Morph Mainnet, BNB Smart Chain, Arbitrum One, Ethereum Mainnet, Polygon PoS, and Base. The initial active network is ${targetNetwork.name}. This connects the wallet to this assistant session; the user must separately approve every transaction in the wallet.\n\nWalletConnect URI (备用，可复制到 Bitget Wallet)：\n${uri}`), qr);
  } catch (error) {
    pairingPromise = null;
    pairingQr = null;
    pairingUri = null;
    pairingQrPath = null;
    if (provider?.off) provider.off('display_uri', onUri);
    // Reset an incomplete provider after URI timeout so the next request gets
    // a fresh WalletConnect pairing instead of reusing a stuck one.
    if (!provider?.session) {
      try { await provider?.disconnect(); } catch { /* no active session */ }
      provider = null;
    }
    throw error;
  } finally { clearTimeout(timer); }
});

server.registerTool('wallet_status', {
  title: 'Check connected wallet',
  description: 'Return the connected Bitget Wallet address and active supported EVM network.',
  inputSchema: {}
}, async () => {
  if (!provider) return textResult(JSON.stringify({ connected: false, status: 'not_connected', selectedNetwork: selectedNetworkKey, supportedNetworks: supportedNetworkSummary() }));
  // While the user is still scanning, EthereumProvider.connect() is pending
  // and request() would throw "Please call connect() before request()". Return
  // an explicit pending state so the agent does not misreport a failed or
  // disconnected wallet and does not generate another QR unnecessarily.
  if (pairingPromise) {
    const settled = await Promise.race([
      pairingPromise.then(() => true, () => true),
      new Promise(resolve => setTimeout(() => resolve(false), 0))
    ]);
    if (!settled) return textResult(JSON.stringify({ connected: false, status: 'waiting_scan', selectedNetwork: selectedNetworkKey, network: getNetwork(selectedNetworkKey).name, supportedNetworks: supportedNetworkSummary() }));
  }
  const { address, chainId, network } = await connectedAccount();
  return textResult(JSON.stringify({ connected: true, address, chainId, network: network.name, networkKey: network.key, authorizationScope: 'all_supported_evm_networks', supportedNetworks: supportedNetworkSummary() }));
});

server.registerTool('wallet_switch_network', {
  title: 'Switch the connected Bitget Wallet network',
  description: 'Request a network switch in Bitget Wallet to one of the supported EVM networks.',
  inputSchema: { network: z.enum(NETWORK_KEYS) }
}, async ({ network: networkKey }) => {
  const network = getNetwork(networkKey);
  const p = requireProvider();
  await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${network.chainId.toString(16)}` }] });
  const status = await connectedAccount();
  if (status.network.key !== networkKey) throw new Error(`Wallet did not switch to ${network.name}.`);
  return textResult(JSON.stringify({ connected: true, address: status.address, chainId: status.chainId, network: status.network.name, networkKey: status.network.key, authorizationScope: 'all_supported_evm_networks' }));
});

server.registerTool('wallet_set_mode', {
  title: 'Set wallet operating mode',
  description: 'Set this bridge session to lightweight or explicitly acknowledged developer mode. Developer mode enables bounded swap authorization and contract deployment while Bitget Wallet remains the signing device.',
  inputSchema: {
    mode: z.enum(['light', 'developer']),
    acknowledgement: z.string().optional()
  }
}, async ({ mode, acknowledgement }) => {
  const accepted = [
    'I understand developer mode enables bounded swap authorization and contract deployment, and Bitget Wallet remains the signing device.',
    '我明白开发者模式用于受限额度授权和合约开发，交易仍由 Bitget Wallet 审核并签名。'
  ];
  if (mode === 'developer' && !accepted.includes(acknowledgement || '')) {
    throw new Error('Developer mode requires an explicit acknowledgement that Bitget Wallet remains the signing device.');
  }
  walletMode = mode;
  if (mode === 'light') swapAuthorizations.clear();
  const localWallet = mode === 'developer' && !localWalletConfiguratorStarted
    ? openLocalWalletConfigurator()
    : { opened: false, reason: mode === 'developer' ? 'already_opened' : 'light_mode' };
  if (mode === 'developer' && localWallet.opened) localWalletConfiguratorStarted = true;
  if (mode === 'light') localWalletConfiguratorStarted = false;
  return textResult(JSON.stringify({
    mode: walletMode,
    signing: 'Bitget Wallet approval required for writes',
    localWalletConfigurator: localWallet
  }));
});

server.registerTool('wallet_disconnect', {
  title: 'Disconnect wallet session',
  description: 'Disconnect the WalletConnect session from this assistant bridge.',
  inputSchema: {}
}, async () => {
  if (provider?.session) await provider.disconnect();
  pairingPromise = null;
  pairingQr = null;
  pairingUri = null;
  pairingQrPath = null;
  try { await unlink(QR_FILE); } catch { /* no QR file to remove */ }
  walletMode = 'light';
  swapAuthorizations.clear();
  return textResult('WalletConnect session disconnected from this assistant bridge.');
});

server.registerTool('wallet_read', {
  title: 'Read EVM chain data',
  description: 'Make a read-only JSON-RPC call on the currently connected supported EVM network. Allowed methods: eth_getBalance, eth_call, eth_blockNumber, eth_getTransactionByHash, eth_getTransactionReceipt, eth_getLogs.',
  inputSchema: {
    method: z.enum(['eth_getBalance', 'eth_call', 'eth_blockNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getLogs']),
    params: z.array(z.unknown()).default([])
  }
}, async ({ method, params }) => {
  const { p, address, chainId } = await connectedAccount();
  const result = await p.request({ method, params });
  return textResult(JSON.stringify({ method, address, chainId, network: networkForChainId(chainId).name, result }));
});

server.registerTool('wallet_send_transaction', {
  title: 'Request a wallet transaction',
  description: 'Ask Bitget Wallet to display and request user approval for a transaction on the connected EVM network. The assistant must explain the exact network, connected address, destination, function/data, value, token amount, and fees, and obtain the user’s clear confirmation before calling this tool. Never use for opaque/unreviewed calldata.',
  inputSchema: {
    to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).default('0x'),
    value: z.string().regex(/^(0x[0-9a-fA-F]+|[0-9]+)$/).default('0x0'),
    feeTokenID: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
    feeLimit: z.string().regex(/^0x[0-9a-fA-F]+$/).optional()
  }
}, async ({ to, data, value, feeTokenID, feeLimit }) => {
  const { p, address, chainId } = await connectedAccount();
  const tx = { from: address, to, data, value, ...(feeTokenID ? { feeTokenID } : {}), ...(feeLimit ? { feeLimit } : {}) };
  const hash = await p.request({ method: 'eth_sendTransaction', params: [tx] });
  return textResult(JSON.stringify({ submitted: true, hash, network: networkForChainId(chainId).name, chainId, ...tx }));
});

async function getSwapQuote(quoteId, address) {
  const quote = pendingSwapQuotes.get(quoteId);
  if (!quote) throw new Error('Swap quote not found or already used. Request a fresh quote.');
  if (quote.expiresAt <= Date.now()) {
    pendingSwapQuotes.delete(quoteId);
    throw new Error('Swap quote expired. Request a fresh quote.');
  }
  if (quote.address.toLowerCase() !== address.toLowerCase()) {
    pendingSwapQuotes.delete(quoteId);
    throw new Error('Wallet account changed. Request a fresh quote.');
  }
  return quote;
}

function assertQuoteNetwork(quote, chainId) {
  if (quote.chainId !== chainId) {
    throw new Error('The connected wallet network changed after this quote was created. Request a fresh quote on the active network.');
  }
}

async function readTokenAllowance(p, tokenAddress, owner, spender) {
  const addressWord = value => value.slice(2).toLowerCase().padStart(64, '0');
  const data = `0xdd62ed3e${addressWord(owner)}${addressWord(spender)}`;
  const result = await p.request({ method: 'eth_call', params: [{ to: tokenAddress, data }, 'latest'] });
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error('Could not verify the input token allowance on the active network.');
  }
  return BigInt(result);
}

function amountToRaw(asset, amount) {
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > asset.decimals) throw new Error(`Amount exceeds ${asset.decimals} decimal places.`);
  const raw = BigInt(whole + fraction.padEnd(asset.decimals, '0'));
  if (raw <= 0n) throw new Error('Amount must be greater than zero.');
  return raw;
}

function storePendingSwapQuote(result, address) {
  for (const [id, pending] of pendingSwapQuotes) {
    if (pending.expiresAt <= Date.now()) pendingSwapQuotes.delete(id);
  }
  while (pendingSwapQuotes.size >= 20) pendingSwapQuotes.delete(pendingSwapQuotes.keys().next().value);
  const quoteId = randomUUID();
  const expiresAt = Date.now() + Math.min(Number(result.expiresInSeconds ?? 300), 300) * 1000;
  pendingSwapQuotes.set(quoteId, { ...result, address, expiresAt });
  return { quoteId, expiresAt };
}

server.registerTool('swap_quote', {
  title: 'Get a Bitget Wallet EVM swap quote',
  description: 'Request a quote and transaction calldata on the currently connected supported EVM network from the Bitget Wallet official Swap API. This does not submit a transaction. Show the active network, pair, amounts, minimum output, slippage, market, target, and value before approval or execution.',
  inputSchema: {
    tokenIn: z.string().min(1).max(32),
    tokenOut: z.string().min(1).max(32),
    tokenInAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    tokenOutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    tokenInDecimals: z.number().int().min(0).max(36).optional(),
    tokenOutDecimals: z.number().int().min(0).max(36).optional(),
    amount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
    slippage: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/).default('1')
  }
  }, async ({ tokenIn, tokenOut, tokenInAddress, tokenOutAddress, tokenInDecimals, tokenOutDecimals, amount, slippage }) => {
  const status = await connectedAccount();
  const result = await getNetworkSwapQuote({ network: status.network.key, tokenIn, tokenOut, tokenInAddress, tokenOutAddress, tokenInDecimals, tokenOutDecimals, amount, slippage, address: status.address });
  const { quoteId, expiresAt } = storePendingSwapQuote(result, status.address);
  const asset = { contract: result.tokenInAddress, decimals: result.tokenInDecimals };
  let allowance = null;
  if (asset.contract) {
    allowance = (await readTokenAllowance(status.p, asset.contract, status.address, result.transaction.to)).toString();
  }
  const amountInRaw = amount.split('.');
  const exactInputAmount = BigInt(amountInRaw[0] + (amountInRaw[1] || '').padEnd(asset.decimals, '0')).toString();
  return textResult(JSON.stringify({
    ...result,
    quoteId,
    expiresAt: new Date(expiresAt).toISOString(),
    spender: asset.contract ? result.transaction.to : null,
    exactInputAmount,
    allowance,
    approvalRequired: allowance !== null && BigInt(allowance) < BigInt(exactInputAmount)
  }));
});

server.registerTool('no_gas_mode', {
  title: 'Check Bitget Wallet NoGas availability',
  description: 'Prepare an official Bitget Wallet NoGas Order Mode swap on the currently connected supported EVM network. This is not a free gas claim. If the quote supports no_gas, the later execution uses EIP-712 signatures and Bitget Wallet covers the native gas fee.',
  inputSchema: {
    tokenIn: z.string().min(1).max(32),
    tokenOut: z.string().min(1).max(32),
    tokenInAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    tokenOutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    tokenInDecimals: z.number().int().min(0).max(36).optional(),
    tokenOutDecimals: z.number().int().min(0).max(36).optional(),
    amount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
    slippage: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/).default('1')
  }
}, async ({ tokenIn, tokenOut, tokenInAddress, tokenOutAddress, tokenInDecimals, tokenOutDecimals, amount, slippage }) => {
  const status = await connectedAccount();
  const result = await getNoGasOrder({ network: status.network.key, tokenIn, tokenOut, tokenInAddress, tokenOutAddress, tokenInDecimals, tokenOutDecimals, amount, slippage, address: status.address });
  const { quoteId, expiresAt } = storePendingSwapQuote({ ...result, expiresInSeconds: 300 }, status.address);
  return textResult(JSON.stringify({
    ...result,
    quoteId,
    expiresAt: new Date(expiresAt).toISOString(),
    noGas: true,
    nativeGasRequired: false,
    signing: 'Bitget Wallet eth_sign of each returned EIP-712 hash',
    execution: 'After showing and obtaining user confirmation for the pair, input amount, minimum output, deadline, and EIP-712 structured signing request, call swap_execute with this quoteId.'
  }));
});

server.registerTool('swap_authorize_session', {
  title: 'Authorize a bounded swap session',
  description: 'In acknowledged developer mode, request one bounded ERC-20 allowance for a token and spender from a live quote. Requires clear user confirmation before submission. This creates an off-chain time window and on-chain amount cap. ERC-20 allowance itself does not expire, and every swap transaction still requires Bitget Wallet approval.',
  inputSchema: {
    quoteId: z.string().uuid(),
    maxAmount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
    durationMinutes: z.number().int().min(1).max(10080)
  }
}, async ({ quoteId, maxAmount, durationMinutes }) => {
  if (walletMode !== 'developer') throw new Error('A bounded swap authorization requires acknowledged developer mode.');
  const { p, address, chainId } = await connectedAccount();
  const quote = await getSwapQuote(quoteId, address);
  assertQuoteNetwork(quote, chainId);
  const asset = { contract: quote.tokenInAddress, decimals: quote.tokenInDecimals };
  if (quote.mode === 'no_gas') throw new Error('NoGas swaps do not use ERC-20 approval. Call swap_execute to sign the official EIP-712 request.');
  if (!asset.contract) throw new Error('Native ETH does not require token approval.');
  const maxAmountRaw = amountToRaw(asset, maxAmount);
  const currentAllowance = await readTokenAllowance(p, asset.contract, address, quote.transaction.to);
  if (currentAllowance > 0n) throw new Error('A token allowance already exists for this spender. Review or revoke it before creating a bounded authorization.');
  const data = `0x095ea7b3${quote.transaction.to.slice(2).toLowerCase().padStart(64, '0')}${maxAmountRaw.toString(16).padStart(64, '0')}`;
  const hash = await p.request({
    method: 'eth_sendTransaction',
    params: [{ from: address, to: asset.contract, data, value: '0x0' }]
  });
  swapAuthorizations.set(`${address.toLowerCase()}:${quote.tokenIn}:${quote.transaction.to.toLowerCase()}`, {
    address,
    token: quote.tokenIn,
    tokenAddress: asset.contract,
    spender: quote.transaction.to,
    chainId,
    maxAmountRaw: maxAmountRaw.toString(),
    durationMinutes,
    approvalHash: hash,
    expiresAt: null
  });
  pendingSwapQuotes.delete(quoteId);
  return textResult(JSON.stringify({
    submitted: true,
    type: 'bounded_swap_authorization',
    network: quote.network,
    networkKey: quote.networkKey,
    chainId: quote.chainId,
    token: quote.tokenIn,
    amountCap: maxAmount,
    spender: quote.transaction.to,
    durationMinutes,
    approvalHash: hash,
    status: 'awaiting_confirmation'
  }));
});

server.registerTool('swap_authorization_status', {
  title: 'Verify bounded swap authorization',
  description: 'Check the pending approval receipt and, after confirmation, activate its off-chain time window. The on-chain ERC-20 allowance remains until spent or revoked.',
  inputSchema: { token: z.string().min(1).max(64) }
}, async ({ token }) => {
  const { p, address, chainId } = await connectedAccount();
  const matches = [...swapAuthorizations.entries()].filter(([, grant]) =>
    grant.address.toLowerCase() === address.toLowerCase() && grant.token === token && grant.chainId === chainId
  );
  if (!matches.length) throw new Error('No bounded swap authorization is pending for this token and wallet.');
  const [key, grant] = matches.at(-1);
  const receipt = await p.request({ method: 'eth_getTransactionReceipt', params: [grant.approvalHash] });
  if (!receipt) return textResult(JSON.stringify({ status: 'pending', approvalHash: grant.approvalHash }));
  if (BigInt(receipt.status) !== 1n) {
    swapAuthorizations.delete(key);
    return textResult(JSON.stringify({ status: 'failed', approvalHash: grant.approvalHash }));
  }
  const allowance = await readTokenAllowance(p, grant.tokenAddress, address, grant.spender);
  const maxAmount = BigInt(grant.maxAmountRaw);
  if (allowance < maxAmount) {
    swapAuthorizations.delete(key);
    return textResult(JSON.stringify({ status: 'allowance_mismatch', allowance: allowance.toString(), expectedAtLeast: grant.maxAmountRaw }));
  }
  if (grant.expiresAt === null) grant.expiresAt = Date.now() + grant.durationMinutes * 60 * 1000;
  return textResult(JSON.stringify({
    status: grant.expiresAt > Date.now() ? 'active' : 'expired',
    token,
    spender: grant.spender,
    amountCapRaw: grant.maxAmountRaw,
    allowanceRemainingRaw: allowance.toString(),
    expiresAt: new Date(grant.expiresAt).toISOString(),
    approvalHash: grant.approvalHash
  }));
});

server.registerTool('swap_authorization_revoke', {
  title: 'Revoke bounded swap allowance',
  description: 'Prepare a zero ERC-20 allowance for the spender in a bounded swap session. Show the current allowance and get clear user confirmation before calling. Bitget Wallet still asks the user to sign.',
  inputSchema: { token: z.string().min(1).max(64) }
}, async ({ token }) => {
  const { p, address, chainId } = await connectedAccount();
  const matching = [...swapAuthorizations.entries()].filter(([, grant]) =>
    grant.address.toLowerCase() === address.toLowerCase() && grant.token === token && grant.chainId === chainId
  );
  if (!matching.length) throw new Error('No bounded swap authorization is recorded for this token and wallet.');
  const [key, grant] = matching.at(-1);
  const allowance = await readTokenAllowance(p, grant.tokenAddress, address, grant.spender);
  if (allowance === 0n) {
    swapAuthorizations.delete(key);
    return textResult(JSON.stringify({ revoked: true, status: 'already_zero', token, spender: grant.spender }));
  }
  const data = `0x095ea7b3${grant.spender.slice(2).toLowerCase().padStart(64, '0')}${'0'.repeat(64)}`;
  const hash = await p.request({
    method: 'eth_sendTransaction',
    params: [{ from: address, to: grant.tokenAddress, data, value: '0x0' }]
  });
  swapAuthorizations.delete(key);
  return textResult(JSON.stringify({ submitted: true, type: 'bounded_swap_authorization_revoke', token, spender: grant.spender, previousAllowance: allowance.toString(), hash }));
});

server.registerTool('swap_approve', {
  title: 'Request exact token approval for a swap',
  description: 'Prepare an exact ERC-20 allowance for a previously displayed Bitget Wallet quote. Call only after showing token, exact amount, spender, active EVM network, and fees and receiving the user’s clear confirmation. Bitget Wallet still asks the user to sign. A fresh quote is required after approval.',
  inputSchema: { quoteId: z.string().uuid() }
}, async ({ quoteId }) => {
  const { p, address, chainId } = await connectedAccount();
  const quote = await getSwapQuote(quoteId, address);
  assertQuoteNetwork(quote, chainId);
  if (quote.mode === 'no_gas') throw new Error('NoGas swaps do not use ERC-20 approval. Call swap_execute to sign the official EIP-712 request.');
  const asset = { contract: quote.tokenInAddress, decimals: quote.tokenInDecimals };
  if (!asset.contract) throw new Error('Native ETH does not require token approval.');
  const exactAmount = BigInt(quote.transaction.value === '0' ? quote.amount.split('.')[0] + (quote.amount.split('.')[1] || '').padEnd(asset.decimals, '0') : '0');
  if (exactAmount <= 0n) throw new Error('Invalid exact approval amount in the saved quote.');
  const allowance = await readTokenAllowance(p, asset.contract, address, quote.transaction.to);
  if (allowance >= exactAmount) throw new Error('Allowance is already sufficient. Request a fresh quote.');
  const data = `0x095ea7b3${quote.transaction.to.slice(2).toLowerCase().padStart(64, '0')}${exactAmount.toString(16).padStart(64, '0')}`;
  pendingSwapQuotes.delete(quoteId);
  const hash = await p.request({
    method: 'eth_sendTransaction',
    params: [{ from: address, to: asset.contract, data, value: '0x0' }]
  });
  return textResult(JSON.stringify({ submitted: true, type: 'exact_swap_approval', token: quote.tokenIn, spender: quote.transaction.to, amount: quote.amount, hash }));
});

server.registerTool('swap_execute', {
  title: 'Request Bitget Wallet swap approval',
  description: 'Submit a saved Bitget Wallet swap on the active supported EVM network. For NoGas orders, first show the pair, amount, minimum output, deadline, and EIP-712 data and obtain clear user confirmation, then Bitget Wallet signs each hash using eth_sign. Every swap still requires Bitget Wallet signing.',
  inputSchema: { quoteId: z.string().uuid() }
}, async ({ quoteId }) => {
  const { p, address, chainId } = await connectedAccount();
  const quote = await getSwapQuote(quoteId, address);
  assertQuoteNetwork(quote, chainId);
  if (quote.mode === 'no_gas') {
    const signedTxs = [];
    for (const signatureRequest of quote.signatures) {
      const signature = await p.request({ method: 'eth_sign', params: [address, signatureRequest.hash] });
      if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
        throw new Error('Bitget Wallet returned an invalid NoGas signature.');
      }
      signedTxs.push(signature);
    }
    const submitted = await submitNoGasOrder({ orderId: quote.orderId, signedTxs });
    pendingSwapQuotes.delete(quoteId);
    return textResult(JSON.stringify({
      submitted: true,
      type: 'no_gas_swap',
      network: quote.network,
      chainId: quote.chainId,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amount: quote.amount,
      estimatedOutput: quote.estimatedOutput,
      minimumOutput: quote.minimumOutput,
      market: quote.market,
      orderId: quote.orderId,
      signedCount: signedTxs.length,
      nativeGasRequired: false,
      result: submitted
    }));
  }
  const asset = { contract: quote.tokenInAddress, decimals: quote.tokenInDecimals };
  if (asset.contract) {
    const amountParts = quote.amount.split('.');
    const exactAmount = BigInt(amountParts[0] + (amountParts[1] || '').padEnd(asset.decimals, '0'));
    const allowance = await readTokenAllowance(p, asset.contract, address, quote.transaction.to);
    if (allowance < exactAmount) throw new Error('Input token allowance is insufficient. Request a fresh quote and approve the exact amount first.');
    if (walletMode === 'developer') {
      const authorization = swapAuthorizations.get(`${address.toLowerCase()}:${quote.tokenIn}:${quote.transaction.to.toLowerCase()}`);
      if (!authorization) {
        throw new Error('No active bounded swap authorization for this token and spender. Authorize a new amount cap and duration first.');
      }
      if (authorization.expiresAt === null) {
        const approvalReceipt = await p.request({ method: 'eth_getTransactionReceipt', params: [authorization.approvalHash] });
        if (!approvalReceipt) throw new Error('Bounded swap authorization is still awaiting wallet confirmation.');
        if (BigInt(approvalReceipt.status) !== 1n) throw new Error('Bounded swap authorization failed on-chain.');
        authorization.expiresAt = Date.now() + authorization.durationMinutes * 60 * 1000;
      }
      if (authorization.expiresAt <= Date.now()) {
        throw new Error('Bounded swap authorization expired. Authorize a new amount cap and duration first.');
      }
      const amountCap = BigInt(authorization.maxAmountRaw);
      if (allowance > amountCap) {
        throw new Error('On-chain allowance exceeds the active bounded authorization. Revoke it and create a new bounded authorization.');
      }
      if (exactAmount > allowance) {
        throw new Error('Swap exceeds the active bounded authorization or remaining on-chain allowance.');
      }
    }
  }
  pendingSwapQuotes.delete(quoteId);
  const tx = {
    from: address,
    to: quote.transaction.to,
    data: quote.transaction.data,
    value: `0x${BigInt(quote.transaction.value).toString(16)}`
  };
  const hash = await p.request({ method: 'eth_sendTransaction', params: [tx] });
  return textResult(JSON.stringify({ submitted: true, type: 'swap', network: quote.network, networkKey: quote.networkKey, chainId: quote.chainId, tokenIn: quote.tokenIn, tokenOut: quote.tokenOut, amount: quote.amount, estimatedOutput: quote.estimatedOutput, minimumOutput: quote.minimumOutput, market: quote.market, hash, transaction: tx }));
});

server.registerTool('wallet_deploy_contract', {
  title: 'Deploy a contract through Bitget Wallet',
  description: 'Submit a contract-creation transaction on Morph Mainnet in acknowledged developer mode. The user must review and sign it in Bitget Wallet; no private key is exposed.',
  inputSchema: {
    bytecode: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
    constructorData: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).default('0x'),
    value: z.string().regex(/^(0x[0-9a-fA-F]+|[0-9]+)$/).default('0x0'),
    feeTokenID: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
    feeLimit: z.string().regex(/^0x[0-9a-fA-F]+$/).optional()
  }
}, async ({ bytecode, constructorData, value, feeTokenID, feeLimit }) => {
  if (walletMode !== 'developer') throw new Error('Contract deployment requires developer mode. Call wallet_set_mode with explicit acknowledgement first.');
  const { p, address, chainId } = await morphDeploymentAccount();
  const data = `${bytecode}${constructorData.slice(2)}`;
  const tx = { from: address, data, value, ...(feeTokenID ? { feeTokenID } : {}), ...(feeLimit ? { feeLimit } : {}) };
  const hash = await p.request({ method: 'eth_sendTransaction', params: [tx] });
  return textResult(JSON.stringify({ submitted: true, hash, network: networkForChainId(chainId).name, chainId, ...tx, mode: walletMode }));
});

const transport = new StdioServerTransport();
await server.connect(transport);
