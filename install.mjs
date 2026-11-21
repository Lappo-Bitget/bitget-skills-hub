#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const sourceSkill = join(sourceRoot, 'skills', 'bitget-agentic-wallet');
const home = homedir();
const codexHome = process.env.CODEX_HOME || join(home, '.codex');
const targetSkill = process.env.BITGET_SKILL_DIR || join(codexHome, 'skills', 'bitget-agentic-wallet');
const bridgeDir = join(targetSkill, 'wallet-bridge');
const bridgeServer = join(bridgeDir, 'server.mjs');
const configPath = process.env.BITGET_CODEX_CONFIG || join(codexHome, 'config.toml');

function log(message) {
  process.stdout.write(`[bitget-skills-hub] ${message}\n`);
}

function configureCodex() {
  mkdirSync(dirname(configPath), { recursive: true });
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const block = `[mcp_servers.bitget-morph-wallet]\ncommand = "node"\nargs = [${JSON.stringify(bridgeServer)}]\n`;
  const header = '[mcp_servers.bitget-morph-wallet]';
  let updated = existing;
  const start = existing.indexOf(header);
  if (start >= 0) {
    const next = existing.indexOf('\n[', start + header.length);
    const end = next >= 0 ? next : existing.length;
    updated = `${existing.slice(0, start)}${block}${existing.slice(end + (next >= 0 ? 1 : 0))}`;
  } else {
    updated = `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}`;
  }
  if (updated !== existing) writeFileSync(configPath, updated, 'utf8');
  log(`Codex MCP 已配置: ${configPath}`);
}

function configureClaudeCode() {
  const claudeConfig = process.env.BITGET_CLAUDE_CONFIG || join(home, '.claude.json');
  let data = {};
  if (existsSync(claudeConfig)) {
    try { data = JSON.parse(readFileSync(claudeConfig, 'utf8')); } catch { data = {}; }
  }
  data.mcpServers = data.mcpServers && typeof data.mcpServers === 'object' ? data.mcpServers : {};
  data.mcpServers['bitget-morph-wallet'] = { command: 'node', args: [bridgeServer] };
  mkdirSync(dirname(claudeConfig), { recursive: true });
  writeFileSync(claudeConfig, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  log(`Claude Code MCP 已配置: ${claudeConfig}`);
}

function installBridge() {
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --ignore-scripts --no-audit --no-fund'], {
      cwd: bridgeDir,
      stdio: 'inherit'
    });
  } else {
    execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: bridgeDir, stdio: 'inherit' });
  }
}

function installSkillForDetectedAgents() {
  if (process.env.BITGET_SKIP_SKILLS_CLI === '1') return;
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    execFileSync(npx, [
      '--yes', 'skills', 'add', 'Lappo-Bitget/bitget-skills-hub',
      '--skill', 'bitget-agentic-wallet', '--agent', '*', '--copy', '-g', '-y'
    ], { stdio: 'inherit' });
    log('技能已分发到检测到的 Agent 客户端。');
  } catch (error) {
    log(`skills CLI 分发失败，将继续使用 Codex 本地安装: ${error.message}`);
  }
}

if (process.argv.includes('--help')) {
  log('一站式安装 Bitget Agent Skill、WalletConnect bridge，并配置 Codex MCP。');
  log('环境变量 BITGET_CONFIGURE_CLAUDE=1 可同时写入 Claude Code 的 ~/.claude.json。');
  process.exit(0);
}
if (!existsSync(sourceSkill)) throw new Error(`找不到技能源文件: ${sourceSkill}`);
installSkillForDetectedAgents();
mkdirSync(dirname(targetSkill), { recursive: true });
cpSync(sourceSkill, targetSkill, { recursive: true, force: true });
log(`技能已安装: ${targetSkill}`);
installBridge();
configureCodex();
if (process.env.BITGET_CONFIGURE_CLAUDE === '1' || existsSync(join(home, '.claude.json'))) configureClaudeCode();
log(`完成。重启智能体后输入“连接我的 Bitget Wallet”即可显示二维码。`);
