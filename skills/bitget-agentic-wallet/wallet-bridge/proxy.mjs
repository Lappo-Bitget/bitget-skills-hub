import { execFileSync } from 'node:child_process';

function normalizeProxyUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function detectSystemProxy() {
  if (process.platform !== 'win32') return null;
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const enable = execFileSync('reg.exe', ['query', key, '/v', 'ProxyEnable'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enable)) return null;
    const server = execFileSync('reg.exe', ['query', key, '/v', 'ProxyServer'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = server.match(/ProxyServer\s+REG_SZ\s+(.+)$/im);
    if (!match) return null;
    const entries = match[1].trim().split(';').map(entry => entry.trim()).filter(Boolean);
    const preferred = entries.find(entry => /^https?=/i.test(entry)) || entries[0];
    return normalizeProxyUrl(preferred?.replace(/^[^=]+=\s*/, ''));
  } catch {
    return null;
  }
}

export function resolveWalletConnectProxy() {
  const configured = process.env.WALLETCONNECT_PROXY
    || process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy
    || process.env.ALL_PROXY || process.env.all_proxy;
  return normalizeProxyUrl(configured) || detectSystemProxy();
}
