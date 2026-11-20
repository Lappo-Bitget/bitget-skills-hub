# Morph Agentic Wallet

Codex Skill for connecting Bitget Wallet to Morph Mainnet through WalletConnect.
It supports Agent ID reads, read-only Morph RPC queries, and user-approved transactions. Private keys and signatures remain inside Bitget Wallet.

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

The bridge never accepts or exports private keys, seed phrases, or signatures. Every transaction is reviewed and signed by the user in Bitget Wallet.
