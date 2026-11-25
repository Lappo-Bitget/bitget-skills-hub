import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { z } from 'zod';
import Ws from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { resolveWalletConnectProxy } from './proxy.mjs';
import { getMorphSwapQuote, MORPH_ASSETS } from './bgw-swap.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { JsonRpcProvider } from 'ethers';
import { createLocalSigner, signAndBroadcastMorph, waitForMorphReceipt } from './local-signer.mjs';

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
const pendingSwapQuotes = new Map();
const swapAuthorizations = new Map();
let localSignerState = null;
let localSignerServer = null;
let localSignerSetup = null;
let localSignerSetupTimer = null;
let localSwapQueue = Promise.resolve();
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

function requireLocalSigner() {
  if (!localSignerState) throw new Error('No local automatic signer is configured. Start local_signer_setup and submit the key in its local window.');
  return localSignerState;
}

function serializeLocalSwap(action) {
  const result = localSwapQueue.then(action, action);
  localSwapQueue = result.catch(() => {});
  return result;
}

function decimalToRaw(asset, amount) {
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > asset.decimals) throw new Error(`Amount exceeds ${asset.decimals} decimal places.`);
  const raw = BigInt(whole + fraction.padEnd(asset.decimals, '0'));
  if (raw <= 0n) throw new Error('Amount must be greater than zero.');
  return raw;
}

function buildLocalPolicy({ tokenIn, tokenOut, maxAmount, maxPerTrade, maxSlippage, durationMinutes, feeLimitWei }) {
  if (tokenIn === tokenOut) throw new Error('The automatic signer needs two different tokens.');
  const token = MORPH_ASSETS[tokenIn];
  if (!token?.contract) throw new Error('Automatic swap input must be an ERC-20 token.');
  const amountCapRaw = decimalToRaw(token, maxAmount);
  const maxPerTradeRaw = decimalToRaw(token, maxPerTrade);
  const slippageValue = Number(maxSlippage);
  if (!Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > 50) throw new Error('Maximum slippage must be greater than zero and no more than 50 percent.');
  if (maxPerTradeRaw > amountCapRaw) throw new Error('Per-trade cap cannot exceed the cumulative amount cap.');
  return { tokenIn, tokenOut, maxAmount, amountCapRaw: amountCapRaw.toString(), maxPerTrade, maxPerTradeRaw: maxPerTradeRaw.toString(), maxSlippage, durationMinutes, feeLimitWei, spender: null, approvalInitialized: false };
}

async function readProviderAllowance(provider, tokenAddress, owner, spender) {
  const word = value => value.slice(2).toLowerCase().padStart(64, '0');
  const data = `0xdd62ed3e${word(owner)}${word(spender)}`;
  const result = await provider.send('eth_call', [{ to: tokenAddress, data }, 'latest']);
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('Could not verify the automatic signer allowance on Morph.');
  return BigInt(result);
}

function localSignerPage(token, policy) {
  const policyDetails = policy
    ? `<p>当前兑换策略：<b>${policy.tokenIn} → ${policy.tokenOut}</b><br>累计上限：<b>${policy.maxAmount} ${policy.tokenIn}</b><br>单笔上限：<b>${policy.maxPerTrade} ${policy.tokenIn}</b><br>最大滑点：<b>${policy.maxSlippage}%</b><br>有效期：<b>${policy.durationMinutes} 分钟</b><br>单笔 BGB 手续费上限：<b>${policy.feeLimitWei} wei</b></p>`
    : '<p>这里只配置本地钱包。兑换策略将在钱包配置完成后单独设置。</p>';
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'self'"><title>Morph 自动交易钱包</title><style>body{font:16px system-ui;max-width:680px;margin:48px auto;padding:0 20px;color:#222}input,button{font:16px;padding:10px;width:100%;box-sizing:border-box;margin:8px 0}button{cursor:pointer} .warn{background:#fff4ce;padding:14px;border-radius:8px}</style><h1>Morph 自动交易钱包</h1><p class="warn">私钥只提交到本机 127.0.0.1，成功后仅保存在当前 MCP 进程内存，不会写入文件或发送到远程服务。请确认这是一个独立的自动交易钱包私钥，不要使用 Bitget Wallet 私钥。</p>${policyDetails}<p>提交后只会配置本地签名器，不会授权额度，也不会执行兑换。私钥不会弹出 Bitget Wallet 审批。只输入专用自动交易钱包的私钥。</p><form method="post" action="/submit?token=${encodeURIComponent(token)}"><label>自动交易钱包私钥</label><input name="privateKey" type="password" autocomplete="off" required pattern="0x[0-9a-fA-F]{64}"><button type="submit">在本机内存中启用</button></form>`;
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
  description: 'Set this bridge session to lightweight or explicitly acknowledged developer mode. Developer mode supports either Bitget Wallet signing or a separate local automatic signer. The local signer uses a dedicated wallet key entered in the local-only setup window and is governed by an explicit policy.',
  inputSchema: {
    mode: z.enum(['light', 'developer']),
    acknowledgement: z.string().optional()
  }
}, async ({ mode, acknowledgement }) => {
  const accepted = [
    'I understand developer mode can automatically sign in-scope transactions with a separate local automation wallet, and that key controls that wallet.',
    '我明白开发者模式可用独立的本地自动交易钱包自动签署授权范围内的交易，私钥拥有该钱包的控制权。'
  ];
  if (mode === 'developer' && !accepted.includes(acknowledgement || '')) {
    throw new Error('Developer mode requires an explicit acknowledgement of the separate local automation wallet and its private-key control.');
  }
  walletMode = mode;
  if (mode === 'light') swapAuthorizations.clear();
  return textResult(JSON.stringify({ mode: walletMode, signing: mode === 'developer' ? 'Select Bitget Wallet or the separately configured local automation signer' : 'Bitget Wallet approval required for writes' }));
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

server.registerTool('local_signer_setup', {
  title: 'Open local automatic signer setup',
  description: 'In acknowledged developer mode, open a loopback-only setup window where the user enters an independent Morph automation-wallet private key. The key is never returned, logged, persisted, or sent to a remote service. This step only configures the signer. Set a swap policy separately with local_signer_policy_set before trading.',
  inputSchema: {}
}, async () => {
  if (walletMode !== 'developer') throw new Error('Automatic signing requires acknowledged developer mode.');
  if (localSignerState) throw new Error('A local automatic signer is already configured. Revoke its allowance and disconnect it before replacing the signer.');
  if (localSignerServer) throw new Error('A local signer setup window is already open. Submit it or wait for it to expire.');
  const sessionToken = randomBytes(24).toString('hex');
  localSignerSetup = {
    token: sessionToken,
    policy: null,
    expiresAt: Date.now() + 10 * 60 * 1000
  };
  localSignerServer = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader('x-frame-options', 'DENY');
    const expectedHost = `127.0.0.1:${localSignerServer.address()?.port}`;
    if (request.headers.host !== expectedHost) {
      response.writeHead(403); response.end('Local host check failed.'); return;
    }
    if (requestUrl.pathname === '/' && request.method === 'GET') {
      if (localSignerSetup.expiresAt <= Date.now()) { response.writeHead(410); response.end('Setup window expired.'); return; }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(localSignerPage(sessionToken, localSignerSetup.policy));
      return;
    }
    if (requestUrl.pathname === '/submit' && request.method === 'POST' && requestUrl.searchParams.get('token') === sessionToken) {
      if (localSignerSetup.expiresAt <= Date.now()) { response.writeHead(410); response.end('Setup window expired.'); return; }
      const expectedOrigin = `http://${expectedHost}`;
      if (request.headers.origin !== expectedOrigin) {
        response.writeHead(403); response.end('Local origin check failed.'); return;
      }
      if (!String(request.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
        response.writeHead(415); response.end('Unsupported form content type.'); return;
      }
      if (localSignerSetup.submitting) {
        response.writeHead(409); response.end('A key submission is already being processed.'); return;
      }
      if (Number(request.headers['content-length'] || 0) > 2048) {
        response.writeHead(413); response.end('Request body is too large.'); return;
      }
      localSignerSetup.submitting = true;
      const bodyChunks = [];
      let bodyBytes = 0;
      request.on('data', chunk => {
        if (response.writableEnded) return;
        bodyBytes += chunk.length;
        if (bodyBytes > 2048) {
          response.writeHead(413); response.end('Request body is too large.');
          request.resume();
          return;
        }
        bodyChunks.push(chunk);
      });
      request.on('end', async () => {
        try {
          if (response.writableEnded || bodyBytes > 2048) return;
          const params = new URLSearchParams(Buffer.concat(bodyChunks).toString('utf8'));
          const privateKey = params.get('privateKey') || '';
          const signer = createLocalSigner(privateKey);
          const provider = new JsonRpcProvider(RPC, Number(CHAIN_ID));
          localSignerState = { signer, provider, policy: localSignerSetup.policy, createdAt: Date.now(), expiresAt: localSignerSetup.policy ? Date.now() + localSignerSetup.policy.durationMinutes * 60 * 1000 : null };
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<h1>已启用</h1><p>自动交易签名器已在本机内存中启用。可以关闭此窗口。</p>');
          clearTimeout(localSignerSetupTimer);
          localSignerSetupTimer = null;
          localSignerServer.close();
          localSignerServer = null;
          localSignerSetup = null;
        } catch (error) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
          response.end(error?.message || 'Invalid local signer.');
        } finally {
          if (localSignerSetup) localSignerSetup.submitting = false;
        }
      });
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { localSignerServer.once('error', reject); localSignerServer.listen(0, '127.0.0.1', resolve); });
  const port = localSignerServer.address().port;
  localSignerSetupTimer = setTimeout(() => {
    if (localSignerSetup?.token !== sessionToken) return;
    localSignerServer?.close();
    localSignerServer = null;
    localSignerSetup = null;
    localSignerSetupTimer = null;
  }, 10 * 60 * 1000);
  localSignerSetupTimer.unref();
  return textResult(JSON.stringify({
    status: 'awaiting_local_key',
    url: `http://127.0.0.1:${port}/`,
    policy: localSignerSetup.policy,
    expiresAt: new Date(localSignerSetup.expiresAt).toISOString(),
    signingPath: 'local_automatic_signer',
    warning: 'This is a separate automation wallet. It is not the connected Bitget Wallet address.'
  }));
});

server.registerTool('local_signer_status', {
  title: 'Check local automatic signer',
  description: 'Return the independent local signer address and policy without exposing its private key. Resolve the status of a previously broadcast allowance transaction before retrying.',
  inputSchema: {}
}, async () => {
  if (!localSignerState) return textResult(JSON.stringify({ status: 'not_configured' }));
  if (!localSignerState.policy) {
    return textResult(JSON.stringify({
      status: 'configured',
      address: localSignerState.signer.address,
      policy: null,
      expiresAt: null,
      signingPath: 'local_automatic_signer'
    }));
  }
  let pendingApproval = null;
  const approvalHash = localSignerState.policy.pendingApprovalHash;
  if (approvalHash) {
    const receipt = await localSignerState.provider.send('eth_getTransactionReceipt', [approvalHash]);
    if (!receipt) {
      pendingApproval = { status: 'pending', hash: approvalHash };
    } else if (BigInt(receipt.status) !== 1n) {
      delete localSignerState.policy.pendingApprovalHash;
      pendingApproval = { status: 'failed', hash: approvalHash, receipt };
    } else {
      const allowance = await readProviderAllowance(
        localSignerState.provider,
        MORPH_ASSETS[localSignerState.policy.tokenIn].contract,
        localSignerState.signer.address,
        localSignerState.policy.spender
      );
      if (allowance !== BigInt(localSignerState.policy.amountCapRaw)) {
        pendingApproval = { status: 'allowance_mismatch', hash: approvalHash, allowance: allowance.toString() };
      } else {
        localSignerState.policy.approvalInitialized = true;
        delete localSignerState.policy.pendingApprovalHash;
        pendingApproval = { status: 'confirmed', hash: approvalHash, allowance: allowance.toString() };
      }
    }
  }
  const revokeHash = localSignerState.policy.pendingRevokeHash;
  let pendingRevoke = null;
  if (revokeHash) {
    const receipt = await localSignerState.provider.send('eth_getTransactionReceipt', [revokeHash]);
    if (!receipt) {
      pendingRevoke = { status: 'pending', hash: revokeHash };
    } else if (BigInt(receipt.status) !== 1n) {
      delete localSignerState.policy.pendingRevokeHash;
      pendingRevoke = { status: 'failed', hash: revokeHash, receipt };
    } else {
      const asset = MORPH_ASSETS[localSignerState.policy.tokenIn];
      const allowance = await readProviderAllowance(localSignerState.provider, asset.contract, localSignerState.signer.address, localSignerState.policy.spender);
      if (allowance !== 0n) {
        pendingRevoke = { status: 'allowance_mismatch', hash: revokeHash, allowance: allowance.toString() };
      } else {
        localSignerState.policy.approvalInitialized = false;
        delete localSignerState.policy.pendingRevokeHash;
        pendingRevoke = { status: 'confirmed', hash: revokeHash, allowance: '0' };
      }
    }
  }
  const swapHash = localSignerState.policy.pendingSwapHash;
  let pendingSwap = null;
  if (swapHash) {
    const receipt = await localSignerState.provider.send('eth_getTransactionReceipt', [swapHash]);
    if (!receipt) {
      pendingSwap = { status: 'pending', hash: swapHash };
    } else {
      delete localSignerState.policy.pendingSwapHash;
      pendingSwap = { status: BigInt(receipt.status) === 1n ? 'confirmed' : 'failed', hash: swapHash, receipt };
    }
  }
  let allowanceStatus = null;
  if (localSignerState.policy.spender) {
    const asset = MORPH_ASSETS[localSignerState.policy.tokenIn];
    const allowanceRemainingRaw = await readProviderAllowance(
      localSignerState.provider,
      asset.contract,
      localSignerState.signer.address,
      localSignerState.policy.spender
    );
    allowanceStatus = {
      token: localSignerState.policy.tokenIn,
      spender: localSignerState.policy.spender,
      initialCapRaw: localSignerState.policy.amountCapRaw,
      allowanceRemainingRaw: allowanceRemainingRaw.toString()
    };
  }
  return textResult(JSON.stringify({
    status: localSignerState.expiresAt > Date.now() ? 'active' : 'expired',
    address: localSignerState.signer.address,
    policy: localSignerState.policy,
    pendingApproval,
    pendingRevoke,
    pendingSwap,
    allowance: allowanceStatus,
    expiresAt: new Date(localSignerState.expiresAt).toISOString(),
    signingPath: 'local_automatic_signer'
  }));
});

server.registerTool('local_signer_disconnect', {
  title: 'Disable local automatic signer',
  description: 'Erase the local signer object and policy from this MCP process memory after confirming its configured on-chain allowance is zero. Revoke the allowance first if needed.',
  inputSchema: {}
}, async () => {
  return serializeLocalSwap(async () => {
  if (localSignerServer) { localSignerServer.close(); localSignerServer = null; }
  clearTimeout(localSignerSetupTimer);
  localSignerSetupTimer = null;
  localSignerSetup = null;
  if (localSignerState?.policy?.spender) {
    const asset = MORPH_ASSETS[localSignerState.policy.tokenIn];
    const allowance = await readProviderAllowance(localSignerState.provider, asset.contract, localSignerState.signer.address, localSignerState.policy.spender);
    if (allowance !== 0n || localSignerState.policy.pendingApprovalHash || localSignerState.policy.pendingRevokeHash || localSignerState.policy.pendingSwapHash) {
      throw new Error('The local signer still has a nonzero allowance or unresolved transaction. Check status, revoke the allowance, and retry disconnect.');
    }
  }
  localSignerState = null;
  return textResult('Local automatic signer disabled and cleared from this MCP process.');
  });
});

server.registerTool('local_signer_policy_set', {
  title: 'Set local signer swap policy',
  description: 'Attach a bounded swap policy to an already configured local signer. This does not open the key-injection page, create an allowance, or submit a transaction. The policy duration starts when this tool is called.',
  inputSchema: {
    tokenIn: z.enum(['BGB', 'USDC', 'USDT0', 'USDe', 'USD1', 'WETH']),
    tokenOut: z.enum(['ETH', 'BGB', 'USDC', 'USDT0', 'USDe', 'USD1', 'WETH']),
    maxAmount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
    maxPerTrade: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
    maxSlippage: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/),
    durationMinutes: z.number().int().min(1).max(10080),
    feeLimitWei: z.string().regex(/^[1-9][0-9]*$/).default('10000000000000000')
  }
}, async ({ tokenIn, tokenOut, maxAmount, maxPerTrade, maxSlippage, durationMinutes, feeLimitWei }) => {
  if (walletMode !== 'developer') throw new Error('Automatic signing requires acknowledged developer mode.');
  const local = requireLocalSigner();
  if (local.policy) throw new Error('A local swap policy is already set. Revoke any allowance and disconnect the signer before setting a different policy.');
  const policy = buildLocalPolicy({ tokenIn, tokenOut, maxAmount, maxPerTrade, maxSlippage, durationMinutes, feeLimitWei });
  local.policy = policy;
  local.expiresAt = Date.now() + durationMinutes * 60 * 1000;
  return textResult(JSON.stringify({ status: 'policy_active', address: local.signer.address, policy, expiresAt: new Date(local.expiresAt).toISOString(), signingPath: 'local_automatic_signer', allowanceCreated: false }));
});

server.registerTool('local_allowance_revoke', {
  title: 'Revoke local automatic-signer allowance',
  description: 'Set the configured local automation wallet ERC-20 allowance for its swap router to zero, wait for the receipt, and verify the on-chain allowance. This broadcasts a transaction with the local signer and does not open Bitget Wallet.',
  inputSchema: {}
}, async () => serializeLocalSwap(async () => {
  const local = requireLocalSigner();
  if (!local.policy) throw new Error('No swap policy is configured for this local signer.');
  if (walletMode !== 'developer') throw new Error('Automatic signing is disabled outside developer mode.');
  const { tokenIn, spender, feeLimitWei } = local.policy;
  const asset = MORPH_ASSETS[tokenIn];
  if (!asset?.contract || !spender) throw new Error('No ERC-20 token and router allowance is configured for this local signer. Request a local quote first.');
  if (local.policy.pendingApprovalHash) throw new Error(`Resolve pending transaction ${local.policy.pendingApprovalHash} before revoking the allowance.`);
  if (local.policy.pendingRevokeHash) throw new Error(`A local allowance revoke is already pending. Inspect ${local.policy.pendingRevokeHash} with local_signer_status.`);
  const allowance = await readProviderAllowance(local.provider, asset.contract, local.signer.address, spender);
  if (allowance === 0n) {
    local.policy.approvalInitialized = false;
    return textResult(JSON.stringify({ revoked: true, status: 'already_zero', token: tokenIn, spender, allowance: '0' }));
  }
  const approveData = `0x095ea7b3${spender.slice(2).toLowerCase().padStart(64, '0')}${'0'.repeat(64)}`;
  let transaction;
  try {
    transaction = await signAndBroadcastMorph({ signer: local.signer, provider: local.provider, transaction: { to: asset.contract, data: approveData, value: '0' }, feeLimitWei });
  } catch (error) {
    if (error?.transactionHash) local.policy.pendingRevokeHash = error.transactionHash;
    throw error;
  }
  local.policy.pendingRevokeHash = transaction.hash;
  const receipt = await waitForMorphReceipt(local.provider, transaction.hash);
  if (BigInt(receipt.status) !== 1n) throw new Error(`Allowance revoke failed. Inspect ${transaction.hash} before retrying.`);
  const remainingAllowance = await readProviderAllowance(local.provider, asset.contract, local.signer.address, spender);
  if (remainingAllowance !== 0n) throw new Error(`Revoke receipt succeeded but allowance is ${remainingAllowance}. Inspect ${transaction.hash}.`);
  local.policy.approvalInitialized = false;
  delete local.policy.pendingRevokeHash;
  return textResult(JSON.stringify({ revoked: true, status: 'confirmed', token: tokenIn, spender, previousAllowance: allowance.toString(), allowance: '0', hash: transaction.hash, receipt }));
}));

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

async function readTokenAllowance(p, tokenAddress, owner, spender) {
  const addressWord = value => value.slice(2).toLowerCase().padStart(64, '0');
  const data = `0xdd62ed3e${addressWord(owner)}${addressWord(spender)}`;
  const result = await p.request({ method: 'eth_call', params: [{ to: tokenAddress, data }, 'latest'] });
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error('Could not verify the input token allowance on Morph.');
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

server.registerTool('swap_quote', {
  title: 'Get a Bitget Wallet Morph swap quote',
  description: 'Request a Morph quote and transaction calldata from Bitget Wallet official Swap API using the local server credentials. This does not submit a transaction. Show the returned pair, amounts, minimum output, slippage, market, target, and value. In lightweight mode, get clear confirmation before approval and swap submissions. In developer mode, an active bounded session authorizes in-scope swaps without repeated conversational confirmation, while Bitget Wallet still requires a signature for every transaction.',
  inputSchema: {
    tokenIn: z.enum(['ETH', 'BGB', 'USDC', 'USDT0', 'USDe', 'USD1', 'WETH']),
    tokenOut: z.enum(['ETH', 'BGB', 'USDC', 'USDT0', 'USDe', 'USD1', 'WETH']),
    amount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
    slippage: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/).default('1')
  }
  }, async ({ tokenIn, tokenOut, amount, slippage }) => {
  const { address } = await connectedAccount();
  const result = await getMorphSwapQuote({ tokenIn, tokenOut, amount, slippage, address });
  const quoteId = randomUUID();
  for (const [id, pending] of pendingSwapQuotes) {
    if (pending.expiresAt <= Date.now()) pendingSwapQuotes.delete(id);
  }
  while (pendingSwapQuotes.size >= 20) pendingSwapQuotes.delete(pendingSwapQuotes.keys().next().value);
  const expiresAt = Date.now() + Math.min(result.expiresInSeconds, 300) * 1000;
  pendingSwapQuotes.set(quoteId, { ...result, address, expiresAt });
  const asset = MORPH_ASSETS[tokenIn];
  let allowance = null;
  if (asset.contract) {
    const { p } = await connectedAccount();
    allowance = (await readTokenAllowance(p, asset.contract, address, result.transaction.to)).toString();
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

server.registerTool('local_swap_quote', {
  title: 'Get an automatic-signer swap quote',
  description: 'Get a quote for the independent local automation wallet. The quote is bounded by the configured token pair, cumulative amount cap, and expiration policy.',
  inputSchema: {
    tokenIn: z.enum(['BGB', 'USDC', 'USDT0', 'USDe', 'USD1', 'WETH']),
    tokenOut: z.enum(['ETH', 'BGB', 'USDC', 'USDT0', 'USDe', 'USD1', 'WETH']),
    amount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
    slippage: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/).default('1')
  }
}, async ({ tokenIn, tokenOut, amount, slippage }) => {
  const local = requireLocalSigner();
  if (!local.policy) throw new Error('No swap policy is configured. Call local_signer_policy_set after the local wallet is ready.');
  if (local.expiresAt <= Date.now()) throw new Error('The local automatic signer policy expired. Configure a new local signer session.');
  if (walletMode !== 'developer') throw new Error('Automatic signing is disabled outside developer mode.');
  if (local.policy.tokenIn !== tokenIn || local.policy.tokenOut !== tokenOut) throw new Error('The swap pair is outside the active automatic signer policy.');
  const asset = MORPH_ASSETS[tokenIn];
  const requestedRaw = decimalToRaw(asset, amount);
  if (requestedRaw > BigInt(local.policy.maxPerTradeRaw)) throw new Error('The swap exceeds the configured per-trade amount cap.');
  if (Number(slippage) > Number(local.policy.maxSlippage)) throw new Error('The requested slippage exceeds the configured policy maximum.');
  const result = await getMorphSwapQuote({ tokenIn, tokenOut, amount, slippage, address: local.signer.address });
  if (local.policy.spender && local.policy.spender.toLowerCase() !== result.transaction.to.toLowerCase()) throw new Error('The quote router differs from the spender authorized for this session.');
  local.policy.spender ||= result.transaction.to;
  const allowanceRemaining = await readProviderAllowance(local.provider, asset.contract, local.signer.address, result.transaction.to);
  const quoteId = randomUUID();
  const expiresAt = Math.min(Date.now() + 300000, local.expiresAt);
  pendingSwapQuotes.set(quoteId, { ...result, address: local.signer.address, expiresAt, signingPath: 'local_automatic_signer' });
  return textResult(JSON.stringify({
    ...result,
    quoteId,
    expiresAt: new Date(expiresAt).toISOString(),
    signingPath: 'local_automatic_signer',
    automationPolicy: local.policy,
    allowanceBudget: {
      initialCapRaw: local.policy.amountCapRaw,
      allowanceRemainingRaw: allowanceRemaining.toString(),
      firstApprovalRequired: !local.policy.approvalInitialized
    }
  }));
});

server.registerTool('local_swap_execute', {
  title: 'Execute an automatic-signer swap',
  description: 'Automatically approve the configured cumulative cap on the first swap, sign the quoted Morph swap locally, broadcast it, and wait for a receipt. The first execution requires an explicit acknowledgement after showing the router, policy, allowance amount, fees, and swap quote. Later user-requested swaps within the active policy do not require another acknowledgement. No Bitget Wallet popup is used.',
  inputSchema: { quoteId: z.string().uuid(), authorization: z.string().optional() }
}, async ({ quoteId, authorization }) => serializeLocalSwap(async () => {
  const local = requireLocalSigner();
  if (!local.policy) throw new Error('No swap policy is configured. Call local_signer_policy_set after the local wallet is ready.');
  if (local.expiresAt <= Date.now()) throw new Error('The local automatic signer policy expired.');
  if (walletMode !== 'developer') throw new Error('Automatic signing is disabled outside developer mode.');
  const quote = await getSwapQuote(quoteId, local.signer.address);
  pendingSwapQuotes.delete(quoteId);
  if (quote.signingPath !== 'local_automatic_signer') throw new Error('This quote belongs to the Bitget Wallet signing path.');
  if (quote.tokenIn !== local.policy.tokenIn || quote.tokenOut !== local.policy.tokenOut) throw new Error('The quote is outside the active automatic signer policy.');
  const asset = MORPH_ASSETS[quote.tokenIn];
  const exactAmount = decimalToRaw(asset, quote.amount);
  if (exactAmount > BigInt(local.policy.maxPerTradeRaw)) throw new Error('The swap exceeds the configured per-trade amount cap.');
  if (Number(quote.slippage) > Number(local.policy.maxSlippage)) throw new Error('The quote exceeds the configured slippage maximum.');
  if (!local.policy.spender || local.policy.spender.toLowerCase() !== quote.transaction.to.toLowerCase()) throw new Error('The quote router differs from the spender authorized for this session.');
  const allowance = await readProviderAllowance(local.provider, asset.contract, local.signer.address, quote.transaction.to);
  const maxAmount = BigInt(local.policy.amountCapRaw);
  let approvalHash = null;
  if (local.policy.pendingApprovalHash) {
    throw new Error(`A local allowance transaction is unresolved. Call local_signer_status and inspect ${local.policy.pendingApprovalHash} before continuing.`);
  }
  if (local.policy.pendingRevokeHash) {
    throw new Error(`A local allowance revoke is unresolved. Call local_signer_status and inspect ${local.policy.pendingRevokeHash} before continuing.`);
  }
  if (!local.policy.approvalInitialized) {
    const acknowledgements = [
      'I authorize the displayed local swap policy, router allowance, and this swap.',
      '我确认授权已展示的本地兑换策略、路由器额度授权和本次兑换。'
    ];
    if (!acknowledgements.includes(authorization || '')) {
      throw new Error('The first local swap requires the exact authorization acknowledgement after the user reviews the router, cumulative allowance, fee cap, expiry, and quote.');
    }
    local.policy.authorizationAcknowledged = true;
    if (allowance !== 0n) throw new Error('The automation wallet already has an allowance for this spender. Revoke and verify it before activating the session.');
    const approveData = `0x095ea7b3${quote.transaction.to.slice(2).toLowerCase().padStart(64, '0')}${maxAmount.toString(16).padStart(64, '0')}`;
    let approval;
    try {
      approval = await signAndBroadcastMorph({ signer: local.signer, provider: local.provider, transaction: { to: asset.contract, data: approveData, value: '0' }, feeLimitWei: local.policy.feeLimitWei });
    } catch (error) {
      if (error?.transactionHash) local.policy.pendingApprovalHash = error.transactionHash;
      throw error;
    }
    approvalHash = approval.hash;
    local.policy.pendingApprovalHash = approval.hash;
    const approvalReceipt = await waitForMorphReceipt(local.provider, approval.hash);
    if (approvalReceipt.status !== '0x1') throw new Error(`Automatic signer approval failed. Inspect ${approval.hash} before retrying.`);
    local.policy.approvalInitialized = true;
    delete local.policy.pendingApprovalHash;
  }
  if (local.expiresAt <= Date.now()) throw new Error('The local automatic signer policy expired before swap broadcast.');
  const remainingAllowance = await readProviderAllowance(local.provider, asset.contract, local.signer.address, quote.transaction.to);
  if (remainingAllowance < exactAmount) throw new Error('The session cumulative allowance is exhausted or too small for this swap.');
  if (remainingAllowance > maxAmount) throw new Error('On-chain allowance exceeds the configured cumulative session cap.');
  let transaction;
  try {
    transaction = await signAndBroadcastMorph({ signer: local.signer, provider: local.provider, transaction: quote.transaction, feeLimitWei: local.policy.feeLimitWei });
  } catch (error) {
    if (error?.transactionHash) local.policy.pendingSwapHash = error.transactionHash;
    throw error;
  }
  local.policy.pendingSwapHash = transaction.hash;
  const receipt = await waitForMorphReceipt(local.provider, transaction.hash);
  if (receipt.status !== '0x1') throw new Error(`Automatic signer swap failed. Inspect ${transaction.hash} before retrying.`);
  delete local.policy.pendingSwapHash;
  const allowanceRemaining = await readProviderAllowance(local.provider, asset.contract, local.signer.address, quote.transaction.to);
  return textResult(JSON.stringify({ submitted: true, confirmed: true, signingPath: 'local_automatic_signer', network: 'Morph Mainnet', chainId: 2818, wallet: local.signer.address, tokenIn: quote.tokenIn, tokenOut: quote.tokenOut, amount: quote.amount, estimatedOutput: quote.estimatedOutput, minimumOutput: quote.minimumOutput, allowanceBudget: { initialCapRaw: local.policy.amountCapRaw, allowanceRemainingRaw: allowanceRemaining.toString() }, approvalHash, hash: transaction.hash, receipt }));
}));

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
  const { p, address } = await connectedAccount();
  const quote = await getSwapQuote(quoteId, address);
  const asset = MORPH_ASSETS[quote.tokenIn];
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
    maxAmountRaw: maxAmountRaw.toString(),
    durationMinutes,
    approvalHash: hash,
    expiresAt: null
  });
  pendingSwapQuotes.delete(quoteId);
  return textResult(JSON.stringify({
    submitted: true,
    type: 'bounded_swap_authorization',
    network: 'Morph Mainnet',
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
  inputSchema: { token: z.enum(['BGB', 'USDC', 'USDT0', 'USDe', 'USD1', 'WETH']) }
}, async ({ token }) => {
  const { p, address } = await connectedAccount();
  const matches = [...swapAuthorizations.entries()].filter(([, grant]) =>
    grant.address.toLowerCase() === address.toLowerCase() && grant.token === token
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
  inputSchema: { token: z.enum(['BGB', 'USDC', 'USDT0', 'USDe', 'USD1', 'WETH']) }
}, async ({ token }) => {
  const { p, address } = await connectedAccount();
  const matching = [...swapAuthorizations.entries()].filter(([, grant]) =>
    grant.address.toLowerCase() === address.toLowerCase() && grant.token === token
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
  description: 'Prepare an exact ERC-20 allowance for a previously displayed Bitget Wallet quote. Call only after showing token, exact amount, spender, Morph network, and fees and receiving the user’s clear confirmation. Bitget Wallet still asks the user to sign. A fresh quote is required after approval.',
  inputSchema: { quoteId: z.string().uuid() }
}, async ({ quoteId }) => {
  const { p, address } = await connectedAccount();
  const quote = await getSwapQuote(quoteId, address);
  const asset = MORPH_ASSETS[quote.tokenIn];
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
  description: 'Submit the saved Bitget Wallet Morph swap transaction. In lightweight mode, require clear user confirmation for this swap. In developer mode, a currently active bounded swap authorization permits submission without another conversational authorization prompt when the token, spender, duration, and remaining allowance match. Every transaction still requires Bitget Wallet signing.',
  inputSchema: { quoteId: z.string().uuid() }
}, async ({ quoteId }) => {
  const { p, address } = await connectedAccount();
  const quote = await getSwapQuote(quoteId, address);
  const asset = MORPH_ASSETS[quote.tokenIn];
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
  return textResult(JSON.stringify({ submitted: true, type: 'swap', network: 'Morph Mainnet', chainId: 2818, tokenIn: quote.tokenIn, tokenOut: quote.tokenOut, amount: quote.amount, estimatedOutput: quote.estimatedOutput, minimumOutput: quote.minimumOutput, market: quote.market, hash, transaction: tx }));
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
