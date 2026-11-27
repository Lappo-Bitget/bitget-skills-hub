# Bitget Skills Hub

Codex Skill for connecting Bitget Wallet to Morph Mainnet, BNB Smart Chain,
Arbitrum One, Ethereum Mainnet, Polygon PoS, and Base through WalletConnect.
It supports multi-network EVM connection/status/read operations and
user-approved wallet transactions. Morph-specific capabilities include bounded
developer-mode swaps and an explicitly selected local
Hardhat build/deploy workflow. WalletConnect keeps keys and signatures inside
Bitget Wallet. The Hardhat path is separate and requires a host-configured
secret provider. No user wallet key is entered into this repository, a local
configuration page, or chat.

## Install the skill

```bash
npx --yes github:Lappo-Bitget/bitget-skills-hub
```

Use the installed skill with any agent that supports Agent Skills. It can
prepare, compile, test, and review Morph deployments using the supported
Hardhat workflow. On the first contract deployment it initializes the current
project automatically; you confirm the exact deployment plan once in the
conversation. Restart the agent after installation.

The WalletConnect MCP server source is included in this repository. One
WalletConnect approval requests all six supported EVM networks, so switching
between them does not require a second wallet connection. The one-step
installer copies the skill and server, installs the server's locked
dependencies, then registers `bitget-agentic-wallet` in detected local clients.
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

The local bridge exposes `swap_quote`, `swap_approve`, `swap_execute`, and
`get_gas` for the official Bitget Wallet Morph Swap API. The bridge calls the
shared proxy at `https://morph-agent-id.pages.dev/api/swap-quote`, so users
installing this repository do not need their own BGW API credentials. The owner configures the
shared API credentials once as Cloudflare Pages Secrets on the `morph-agent-id`
project:

`get_gas` uses Bitget Wallet's official NoGas Order Mode. It checks the quote's
`features` for `no_gas`, creates the order, and returns EIP-712 hashes for
Bitget Wallet to sign. `swap_execute` signs those hashes with `eth_sign` and
submits them through the official `submitSwapOrder` flow. NoGas is gas-sponsored
swap execution, not a native-token faucet, and is available only when Bitget
Wallet reports support for the selected stablecoin pair.

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

For repeated swaps, developer mode uses the connected Bitget Wallet. It
authorizes one chosen input token, cumulative amount cap, and duration of up to
seven days for a specific router spender. Bitget Wallet still asks the user to
sign each transaction. The bridge enforces the time window and input amount cap,
while the ERC-20 allowance remains until spent or explicitly revoked.

## Network proxy

The installer and bridge detect a configured Windows system HTTP proxy automatically and use it for WalletConnect's WebSocket relay. This keeps the MCP bridge aligned with the proxy used by the desktop wallet and browser.

On restricted networks, set `WALLETCONNECT_PROXY` to an HTTP(S) proxy URL or pass `--proxy=http://127.0.0.1:7890` to the installer. `HTTPS_PROXY`, `HTTP_PROXY`, and `ALL_PROXY` are also supported. Explicit environment variables and the `--proxy` option take precedence over the system setting.

The bridge validates the proxy scheme before starting. It routes only WalletConnect WebSocket traffic through the proxy and keeps Morph RPC requests on their configured endpoint. After changing the proxy or MCP configuration, restart the client so it launches a fresh bridge process.

## GitHub automatic sync

This checkout uses the tracked `.githooks/post-commit` hook. After each local
commit on a named branch, it pushes that branch to the `origin` remote. A
network failure leaves the commit local and prints a retry command. The hook
does not add or commit files automatically. To enable the same hook after
cloning this repository, run:

```powershell
git config core.hooksPath .githooks
```

## Security

The bridge never accepts wallet keys in chat, terminal prompts, or local
configuration pages. WalletConnect transactions remain reviewed and signed in
Bitget Wallet. Hardhat deployment is available only when the host supplies
`MORPH_DEPLOYER_PRIVATE_KEY` through a trusted secret provider. The value is
never printed, persisted, or committed. See
`skills/bitget-agentic-wallet/references/hardhat-morph.md`.
