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
QR image. The bridge also saves the current QR as `walletconnect-qr.png` beside
the server and returns its absolute path as a client-rendering fallback. Codex
opens that saved PNG in the right panel when the local file viewer is available.
Use
`--agent=codex`, `--agent=claude-code`, or another supported name
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

## Bitget Wallet official Morph Swap API

The local bridge exposes `swap_quote`, `swap_approve`, and `swap_execute` for
the official Bitget Wallet Morph Swap API. The bridge calls the shared proxy at
`https://morph-agent-id.pages.dev/api/swap-quote`, so users installing this
repository do not need their own BGW API credentials. The owner configures the
shared API credentials once as Cloudflare Pages Secrets on the `morph-agent-id`
project:

```text
BGW_API_KEY=your_api_key
BGW_API_SECRET=your_api_secret
```

From the repository's `agent-id-protocol` directory, run these commands in a
local terminal. Wrangler prompts for each value; enter it directly at the
terminal prompt. Do not paste it into chat, commit it, or put it in the skill
files:

```powershell
npx wrangler pages secret put BGW_API_KEY --project-name morph-agent-id
npx wrangler pages secret put BGW_API_SECRET --project-name morph-agent-id
```

If either secret is missing, the proxy returns a configuration error and
`swap_quote` stops. The quote is one-use and expires. ERC-20 approval and Swap
are separate wallet confirmations, and the bridge never bypasses Bitget Wallet
signing.

For repeated swaps, select the bridge's developer mode and use the bounded swap
session flow. It authorizes one chosen input token, cumulative amount cap, and
duration of up to seven days for a specific router spender. The time window is
enforced by the bridge and the amount cap is enforced by the ERC-20 allowance.
ERC-20 allowances have no native expiry, so unused allowance remains until it
is spent or revoked. Bitget Wallet still asks the user to sign every swap
transaction.

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
