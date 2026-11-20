# Morph Agentic Wallet

Codex Skill for connecting Bitget Wallet to Morph Mainnet through WalletConnect.
It supports Agent ID reads, read-only Morph RPC queries, user-approved wallet
transactions, and an explicitly selected local Hardhat build/deploy workflow.
The WalletConnect path keeps keys and signatures inside Bitget Wallet. The
Hardhat path is separate and requires a host-configured secret provider; the
skill never accepts a key in chat or provisions one automatically.

## Install

```bash
npx skills add Lappo-Bitget/morph-agentic-wallet --skill bitget-agentic-wallet
cd ~/.codex/skills/bitget-agentic-wallet/wallet-bridge
npm ci
```

Restart Codex after installation and ask it to use `bitget-agentic-wallet`.

## Network proxy

The bridge uses direct WebSocket by default. On restricted networks, set `WALLETCONNECT_PROXY` to an HTTP(S) proxy URL. `HTTPS_PROXY`, `HTTP_PROXY`, and `ALL_PROXY` are also supported.

## Security

The bridge never accepts or exports private keys, seed phrases, or signatures.
Every WalletConnect transaction is reviewed and signed by the user in Bitget
Wallet. Hardhat deployment is available only when the host supplies
`MORPH_DEPLOYER_PRIVATE_KEY` through a trusted secret provider; see
`skills/bitget-agentic-wallet/references/hardhat-morph.md`. The value is never
printed, persisted, or committed.
