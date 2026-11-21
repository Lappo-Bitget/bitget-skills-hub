# Morph Agentic Wallet

Codex Skill for connecting Bitget Wallet to Morph Mainnet through WalletConnect.
It supports Agent ID reads, read-only Morph RPC queries, user-approved wallet
transactions, and an explicitly selected local Hardhat build/deploy workflow.
The WalletConnect path keeps keys and signatures inside Bitget Wallet. The
Hardhat path is separate and requires a host-configured secret provider; the
skill never accepts a key in chat or provisions one automatically.

## Install the skill

```bash
npx skills add Lappo-Bitget/morph-agentic-wallet --skill bitget-agentic-wallet -g -y
```

Use the installed skill with any agent that supports Agent Skills. It can
prepare, compile, test, and review Morph deployments using the supported
Hardhat workflow. On the first contract deployment it initializes the current
project automatically; you confirm the exact deployment plan once in the
conversation. Restart the agent after installation.

The QR connection requires the host to expose the bundled
`bitget-morph-wallet` MCP bridge. Hosts that honor
`skills/bitget-agentic-wallet/agents/openai.yaml` can register the bridge from
the declared dependency. On a host that does not, install the bridge
dependencies and register this MCP server manually.

```bash
cd <installed-skill>/wallet-bridge
npm ci --ignore-scripts
```

Register the command `node <installed-skill>/wallet-bridge/server.mjs` under
the MCP server name `bitget-morph-wallet`, then restart the agent. Ask the
agent to connect Bitget Wallet. It must show the returned PNG QR before asking
the user to scan. Bitget Wallet still requires the user to approve each
transaction.

## Network proxy

The bridge uses direct WebSocket by default. On restricted networks, set `WALLETCONNECT_PROXY` to an HTTP(S) proxy URL. `HTTPS_PROXY`, `HTTP_PROXY`, and `ALL_PROXY` are also supported.

## Security

The bridge never accepts or exports private keys, seed phrases, or signatures.
Every WalletConnect transaction is reviewed and signed by the user in Bitget
Wallet. Hardhat deployment is available only when the host supplies
`MORPH_DEPLOYER_PRIVATE_KEY` through a trusted secret provider; see
`skills/bitget-agentic-wallet/references/hardhat-morph.md`. The value is never
printed, persisted, or committed. Do not paste a key into chat.
