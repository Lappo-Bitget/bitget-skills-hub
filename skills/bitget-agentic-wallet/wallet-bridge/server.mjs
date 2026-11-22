import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { z } from 'zod';
import Ws from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { resolveWalletConnectProxy } from './proxy.mjs';

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

const CHAIN_ID = 2818;
const RPC = 'https://rpc-bgw.morph.network';
const PROJECT_ID = process.env.WALLETCONNECT_PROJECT_ID || '8c4660c0aeaeebdec859180fb6679463';
const DAPP_URL = 'https://morph-agent-id.pages.dev/';
const QR_FILE = fileURLToPath(new URL('./walletconnect-qr.png', import.meta.url));
let provider = null;
let pairingPromise = null;
let pairingQr = null;
let pairingUri = null;
let pairingQrPath = null;
let walletMode = 'light';
try { await unlink(QR_FILE); } catch { /* remove a stale QR from a previous bridge process */ }

const server = new McpServer({ name: 'bitget-wallet-morph', version: '0.1.0' });

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
async function connectedAccount() {
  const p = requireProvider();
  const accounts = await p.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts) || !accounts.length) throw new Error('WalletConnect session is not approved. Reconnect with Bitget Wallet.');
  const chainId = BigInt(await p.request({ method: 'eth_chainId' }));
  if (chainId !== BigInt(CHAIN_ID)) throw new Error('Wallet is not on Morph Mainnet. Switch networks in Bitget Wallet.');
  return { p, address: accounts[0], chainId: Number(chainId) };
}

server.registerTool('connect_wallet', {
  title: 'Connect Bitget Wallet by QR',
  description: 'Create a WalletConnect pairing QR in this conversation. The user scans and approves it in Bitget Wallet. Returns the QR image; connection persists in this MCP process.',
  inputSchema: { }
}, async () => {
  if (!provider) {
    provider = await EthereumProvider.init({
      projectId: PROJECT_ID,
      chains: [CHAIN_ID],
      optionalChains: [CHAIN_ID],
      methods: ['eth_sendTransaction'],
      optionalMethods: ['wallet_switchEthereumChain'],
      showQrModal: false,
      rpcMap: { [CHAIN_ID]: RPC },
      metadata: {
        name: 'Bitget Agentic Wallet · Morph',
        description: 'User-controlled Bitget Wallet connection for Morph Mainnet',
        url: DAPP_URL,
        icons: []
      }
    });
  }
  try {
    const status = await connectedAccount();
    return textResult(`Already connected: ${status.address} on Morph Mainnet.`);
  } catch { /* no active approved session; start pairing */ }

  if (pairingPromise) {
    const uriText = pairingUri ? `\n\nWalletConnect URI (备用，可复制到 Bitget Wallet)：\n${pairingUri}` : '';
    return textResult(pairingText(`A WalletConnect pairing is already pending. Scan this QR with Bitget Wallet.${uriText}`), pairingQr);
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
    return textResult(pairingText(`Scan this high-resolution QR with Bitget Wallet. Approve the WalletConnect request for Morph Mainnet. This connects the wallet to this assistant session; the user must separately approve every transaction in the wallet.\n\nWalletConnect URI (备用，可复制到 Bitget Wallet)：\n${uri}`), qr);
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
  description: 'Return the connected Bitget Wallet address and verify that the wallet is on Morph Mainnet.',
  inputSchema: {}
}, async () => {
  if (!provider) return textResult(JSON.stringify({ connected: false, status: 'not_connected', network: 'Morph Mainnet' }));
  // While the user is still scanning, EthereumProvider.connect() is pending
  // and request() would throw "Please call connect() before request()". Return
  // an explicit pending state so the agent does not misreport a failed or
  // disconnected wallet and does not generate another QR unnecessarily.
  if (pairingPromise) {
    const settled = await Promise.race([
      pairingPromise.then(() => true, () => true),
      new Promise(resolve => setTimeout(() => resolve(false), 0))
    ]);
    if (!settled) return textResult(JSON.stringify({ connected: false, status: 'waiting_scan', network: 'Morph Mainnet' }));
  }
  const { address, chainId } = await connectedAccount();
  return textResult(JSON.stringify({ connected: true, address, network: 'Morph Mainnet' }));
});

server.registerTool('wallet_set_mode', {
  title: 'Set wallet operating mode',
  description: 'Set this bridge session to lightweight or explicitly acknowledged developer mode. Developer mode never exports keys or bypasses Bitget Wallet approval.',
  inputSchema: {
    mode: z.enum(['light', 'developer']),
    acknowledgement: z.string().optional()
  }
}, async ({ mode, acknowledgement }) => {
  const accepted = [
    'I understand every transaction still requires Bitget Wallet approval.',
    '我明白每笔交易仍需在 Bitget Wallet 中审批。'
  ];
  if (mode === 'developer' && !accepted.includes(acknowledgement || '')) {
    throw new Error('Developer mode requires an explicit acknowledgement that every transaction still requires Bitget Wallet approval.');
  }
  walletMode = mode;
  return textResult(JSON.stringify({ mode: walletMode, signing: 'Bitget Wallet approval required for every transaction' }));
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
  return textResult('WalletConnect session disconnected from this assistant bridge.');
});

server.registerTool('wallet_read', {
  title: 'Read Morph chain data',
  description: 'Make a read-only Morph JSON-RPC call using the connected wallet session. Allowed methods: eth_getBalance, eth_call, eth_blockNumber, eth_getTransactionByHash, eth_getTransactionReceipt, eth_getLogs.',
  inputSchema: {
    method: z.enum(['eth_getBalance', 'eth_call', 'eth_blockNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getLogs']),
    params: z.array(z.unknown()).default([])
  }
}, async ({ method, params }) => {
  const { p, address, chainId } = await connectedAccount();
  const result = await p.request({ method, params });
  return textResult(JSON.stringify({ method, address, result }));
});

server.registerTool('wallet_send_transaction', {
  title: 'Request a wallet transaction',
  description: 'Ask Bitget Wallet to display and request user approval for a Morph transaction. The assistant must explain the exact network, connected address, destination, function/data, value, token amount, and fees, and obtain the user’s clear confirmation before calling this tool. Never use for opaque/unreviewed calldata.',
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
  return textResult(JSON.stringify({ submitted: true, hash, ...tx }));
});

server.registerTool('wallet_deploy_contract', {
  title: 'Deploy a contract through Bitget Wallet',
  description: 'Submit a Morph contract-creation transaction in acknowledged developer mode. The user must review and sign it in Bitget Wallet; no private key is exposed.',
  inputSchema: {
    bytecode: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
    constructorData: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).default('0x'),
    value: z.string().regex(/^(0x[0-9a-fA-F]+|[0-9]+)$/).default('0x0'),
    feeTokenID: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
    feeLimit: z.string().regex(/^0x[0-9a-fA-F]+$/).optional()
  }
}, async ({ bytecode, constructorData, value, feeTokenID, feeLimit }) => {
  if (walletMode !== 'developer') throw new Error('Contract deployment requires developer mode. Call wallet_set_mode with explicit acknowledgement first.');
  const { p, address, chainId } = await connectedAccount();
  const data = `${bytecode}${constructorData.slice(2)}`;
  const tx = { from: address, data, value, ...(feeTokenID ? { feeTokenID } : {}), ...(feeLimit ? { feeLimit } : {}) };
  const hash = await p.request({ method: 'eth_sendTransaction', params: [tx] });
  return textResult(JSON.stringify({ submitted: true, hash, ...tx, mode: walletMode }));
});

const transport = new StdioServerTransport();
await server.connect(transport);
