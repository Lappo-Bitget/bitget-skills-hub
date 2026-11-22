# Bitget Skills Hub

Codex Skill for connecting Bitget Wallet to Morph Mainnet through WalletConnect.
It supports Agent ID reads, read-only Morph RPC queries, user-approved wallet
transactions, and an explicitly selected local Hardhat build/deploy workflow.
The WalletConnect path keeps keys and signatures inside Bitget Wallet. The
Hardhat path is separate and requires a host-configured secret provider; the
skill never accepts a key in chat or provisions one automatically.

## Install the skill

```bash
npx --yes github:Lappo-Bitget/bitget-skills-hub
```

Use the installed skill with any agent that supports Agent Skills. It can
prepare, compile, test, and review Morph deployments using the supported
Hardhat workflow. On the first contract deployment it initializes the current
project automatically; you confirm the exact deployment plan once in the
conversation. Restart the agent after installation.

The WalletConnect MCP server source is included in this repository. The
one-step installer copies the skill and server, installs the server's locked
dependencies, then registers `bitget-morph-wallet` in detected local clients.
It handles Codex, Claude Code, Claude Desktop, Cursor, Windsurf, Gemini CLI,
and Cline when their local configuration directories are present. Restart the
client after installation, then ask it to connect Bitget Wallet. The client
loads `connect_wallet` from the registered MCP server and displays its returned
QR image. Use `--agent=codex`, `--agent=claude-code`, or another supported name
to target one client explicitly.

This installs a local stdio MCP process. It works with clients that support
local MCP servers and Agent Skills. A hosted agent that cannot launch local MCP
processes must provide its own MCP hosting mechanism before it can call the
wallet tools.

The original skill-only command remains available for hosts that manage MCP
servers themselves:

```bash
npx skills add Lappo-Bitget/bitget-skills-hub --skill bitget-agentic-wallet -g -y
```

## Network proxy

The installer and bridge detect a configured Windows system HTTP proxy automatically and use it for WalletConnect's WebSocket relay. This keeps the MCP bridge aligned with the proxy used by the desktop wallet and browser.

On restricted networks, set `WALLETCONNECT_PROXY` to an HTTP(S) proxy URL or pass `--proxy=http://127.0.0.1:7890` to the installer. `HTTPS_PROXY`, `HTTP_PROXY`, and `ALL_PROXY` are also supported. Explicit environment variables and the `--proxy` option take precedence over the system setting.

The bridge validates the proxy scheme before starting. It routes only WalletConnect WebSocket traffic through the proxy and keeps Morph RPC requests on their configured endpoint. After changing the proxy or MCP configuration, restart the client so it launches a fresh bridge process.

## Security

The bridge never accepts or exports private keys, seed phrases, or signatures.
Every WalletConnect transaction is reviewed and signed by the user in Bitget
Wallet. Hardhat deployment is available only when the host supplies
`MORPH_DEPLOYER_PRIVATE_KEY` through a trusted secret provider; see
`skills/bitget-agentic-wallet/references/hardhat-morph.md`. The value is never
printed, persisted, or committed. Do not paste a key into chat.
