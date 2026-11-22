#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSystemProxy } from './skills/bitget-agentic-wallet/wallet-bridge/proxy.mjs';

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const sourceSkill = join(sourceRoot, 'skills', 'bitget-agentic-wallet');
const home = homedir();
const roaming = process.env.APPDATA || join(home, 'AppData', 'Roaming');
const codexHome = process.env.CODEX_HOME || join(home, '.codex');
const proxyOption = process.argv.find(argument => argument.startsWith('--proxy='))?.slice('--proxy='.length);
const configuredProxy = (proxyOption && proxyOption !== 'auto' ? proxyOption : null)
  || process.env.WALLETCONNECT_PROXY
  || process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy
  || process.env.ALL_PROXY || process.env.all_proxy
  || detectSystemProxy();
const claudeDesktopConfig = process.platform === 'win32'
  ? join(roaming, 'Claude', 'claude_desktop_config.json')
  : process.platform === 'darwin'
    ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : join(home, '.config', 'Claude', 'claude_desktop_config.json');
const clients = [
  { name: 'Codex', skillDir: join(codexHome, 'skills'), config: process.env.BITGET_CODEX_CONFIG || join(codexHome, 'config.toml'), format: 'toml', detect: () => existsSync(codexHome) },
  { name: 'Claude Code', skillDir: join(home, '.claude', 'skills'), config: process.env.BITGET_CLAUDE_CONFIG || join(home, '.claude.json'), format: 'json', detect: () => existsSync(join(home, '.claude')) || existsSync(join(home, '.claude.json')) },
  { name: 'Claude Desktop', skillDir: join(home, '.claude', 'skills'), config: claudeDesktopConfig, format: 'json', detect: () => existsSync(claudeDesktopConfig) },
  { name: 'Cursor', skillDir: join(home, '.cursor', 'skills'), config: join(home, '.cursor', 'mcp.json'), format: 'json', detect: () => existsSync(join(home, '.cursor')) },
  { name: 'Windsurf', skillDir: join(home, '.codeium', 'windsurf', 'skills'), config: join(home, '.codeium', 'windsurf', 'mcp_config.json'), format: 'json', detect: () => existsSync(join(home, '.codeium', 'windsurf')) },
  { name: 'Gemini CLI', skillDir: join(home, '.gemini', 'skills'), config: join(home, '.gemini', 'settings.json'), format: 'json', detect: () => existsSync(join(home, '.gemini')) },
  { name: 'Cline', skillDir: join(home, '.agents', 'skills'), config: join(roaming, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), format: 'json', detect: () => existsSync(join(roaming, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev')) }
];

function log(message) {
  process.stdout.write(`[bitget-skills-hub] ${message}\n`);
}

if (configuredProxy) {
  const proxyLabel = new URL(configuredProxy);
  log(`WalletConnect proxy configured: ${proxyLabel.protocol}//${proxyLabel.host}`);
}

function configureToml(configPath, bridgeServer) {
  mkdirSync(dirname(configPath), { recursive: true });
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const header = '[mcp_servers.bitget-morph-wallet]';
  const start = existing.indexOf(header);
  let existingEnvLine = '';
  if (start >= 0) {
    const next = existing.indexOf('\n[', start + header.length);
    const end = next >= 0 ? next : existing.length;
    const section = existing.slice(start, end);
    existingEnvLine = section.split(/\r?\n/).find(line => /^env\s*=/.test(line)) || '';
  }
  let envLine = existingEnvLine;
  if (configuredProxy) {
    const serialized = JSON.stringify(configuredProxy);
    if (existingEnvLine && /WALLETCONNECT_PROXY\s*=/.test(existingEnvLine)) {
      envLine = existingEnvLine.replace(/(WALLETCONNECT_PROXY\s*=\s*)"[^"]*"/, `$1${serialized}`);
    } else if (existingEnvLine && existingEnvLine.includes('{')) {
      envLine = existingEnvLine.replace(/}\s*$/, `, WALLETCONNECT_PROXY = ${serialized} }`);
    } else {
      envLine = `env = { WALLETCONNECT_PROXY = ${serialized} }`;
    }
  }
  const block = `[mcp_servers.bitget-morph-wallet]\ncommand = "node"\nargs = [${JSON.stringify(bridgeServer)}]${envLine ? `\n${envLine}` : ''}\n`;
  const updated = start >= 0
    ? `${existing.slice(0, start)}${block}${existing.slice(existing.indexOf('\n[', start + header.length) >= 0 ? existing.indexOf('\n[', start + header.length) + 1 : existing.length)}`
    : `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}`;
  if (updated !== existing) writeFileSync(configPath, updated, 'utf8');
}

function configureJson(configPath, bridgeServer) {
  mkdirSync(dirname(configPath), { recursive: true });
  let data = {};
  if (existsSync(configPath)) {
    try { data = JSON.parse(readFileSync(configPath, 'utf8')); }
    catch { throw new Error(`无法解析现有配置文件，已保留原文件: ${configPath}`); }
  }
  data.mcpServers = data.mcpServers && typeof data.mcpServers === 'object' ? data.mcpServers : {};
  const previous = data.mcpServers['bitget-morph-wallet'];
  const env = previous?.env && typeof previous.env === 'object' ? { ...previous.env } : {};
  if (configuredProxy) env.WALLETCONNECT_PROXY = configuredProxy;
  data.mcpServers['bitget-morph-wallet'] = {
    command: 'node',
    args: [bridgeServer],
    ...(Object.keys(env).length ? { env } : {})
  };
  writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function configureClient(client, skillPath) {
  const bridgeServer = join(skillPath, 'wallet-bridge', 'server.mjs');
  if (client.format === 'toml') configureToml(client.config, bridgeServer);
  else configureJson(client.config, bridgeServer);
  log(`${client.name} 技能和 MCP 已配置: ${client.config}`);
}

function installBridgeAt(skillPath) {
  const bridgeDir = join(skillPath, 'wallet-bridge');
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --ignore-scripts --no-audit --no-fund'], {
      cwd: bridgeDir,
      stdio: 'inherit'
    });
  } else {
    execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: bridgeDir, stdio: 'inherit' });
  }
}

if (process.argv.includes('--help')) {
  log('一站式安装 Bitget Agent Skill、WalletConnect bridge，并配置本机已检测到的 Codex、Claude Code、Cursor、Windsurf、Gemini CLI 和 Cline。');
  process.exit(0);
}
if (!existsSync(sourceSkill)) throw new Error(`找不到技能源文件: ${sourceSkill}`);
const agentOption = process.argv.find(argument => argument.startsWith('--agent='));
const requestedAgents = agentOption?.slice('--agent='.length).split(',').map(value => value.trim().toLowerCase());
const selectedClients = requestedAgents?.length
  ? clients.filter(client => requestedAgents.includes(client.name.toLowerCase().replaceAll(' ', '-')))
  : clients.filter(client => client.detect());
if (requestedAgents?.length && selectedClients.length !== requestedAgents.length) {
  throw new Error(`不支持的 Agent 名称: ${requestedAgents.filter(name => !clients.some(client => client.name.toLowerCase().replaceAll(' ', '-') === name)).join(', ')}`);
}
if (!selectedClients.length) selectedClients.push(clients[0]);
for (const client of selectedClients) {
  const skillPath = join(client.skillDir, 'bitget-agentic-wallet');
  mkdirSync(client.skillDir, { recursive: true });
  cpSync(sourceSkill, skillPath, { recursive: true, force: true });
  log(`技能已安装到 ${client.name}: ${skillPath}`);
  installBridgeAt(skillPath);
  configureClient(client, skillPath);
}
log('完成。重启已配置的智能体，然后输入“连接我的 Bitget Wallet”即可显示二维码。');
