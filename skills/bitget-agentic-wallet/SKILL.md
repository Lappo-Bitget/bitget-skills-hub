---
name: bitget-agentic-wallet
description: >-
  Use for Bitget Wallet operations on Morph Mainnet, including Agent ID reads,
  lightweight wallet queries, user-approved transactions, and developer-mode
  contract deployment requests. Keep all keys and signatures inside Bitget Wallet.
---

# Bitget Wallet on Morph

This skill uses the local WalletConnect bridge in `wallet-bridge/server.mjs` for
the user's Bitget Wallet on Morph Mainnet. The bridge can request transactions,
but Bitget Wallet remains the signer. A WalletConnect session is not a private
key export and cannot grant unlimited background signing authority.

## Select one operating mode

Choose the mode from the user's request. If the user does not choose a mode,
use **lightweight mode**.

### Lightweight mode (default)

Use for connection/status, balances, allowances, Agent ID lookup, contract reads,
transaction/receipt inspection, and the existing Agent ID mint flow. Writes are
limited to a clearly described, user-requested operation. Before every write,
show the chain, connected address, destination or deployment target, function,
calldata/value, token amount, fee token, and expected gas; obtain a fresh clear
confirmation, then call the wallet tool. Verify the receipt and resulting state.

### Developer mode (explicit opt-in)

Use only after the user explicitly asks to enable developer mode for this
conversation and confirms that they understand it can request arbitrary Morph
transactions and contract deployments. Developer mode expands the request
surface to:

- arbitrary contract calls and native/ERC-20 transfers;
- contract deployment transactions with creation bytecode and constructor data;
- Morph fee-token fields (`feeTokenID`, `feeLimit`) when supported by the wallet.

Developer mode does **not** mean handing over a private key, seed phrase, or
unlimited automatic signing. Every transaction is still shown and approved in
Bitget Wallet. Never batch opaque transactions, silently enlarge allowances, or
claim that a deployment succeeded until its receipt and deployed address are
verified. If the user asks for unattended or unlimited signing, explain that
the wallet bridge does not provide that capability.

When entering developer mode, state the scope plainly: “Developer mode can
prepare arbitrary Morph transactions and deployments; Bitget Wallet will ask you
to review and sign each one.” For each request, retain the same transaction
review and confirmation gate as lightweight mode.

## Actual workflows

- Connect with `connect_wallet`; ask the user to scan the QR in Bitget Wallet.
- Verify `wallet_status` reports the approved address and Morph Mainnet (chain
  ID `2818`).
- Use `wallet_read` for the supported read-only JSON-RPC methods.
- Use `wallet_send_transaction` for a call/transfer. In developer mode, `to` may
  be omitted only for contract creation and the creation bytecode must be shown.
- Use `wallet_deploy_contract` for deployment. It submits a transaction with no
  `to` field and requires the user to review/sign it in Bitget Wallet.
- After a hash is returned, query the receipt before reporting success. For a
  deployment, verify `contractAddress` and bytecode at that address.

## WalletConnect network compatibility

The bridge uses a direct WebSocket connection by default, so it works for users
whose network can reach the WalletConnect relay without special configuration.
For a restricted network, set `WALLETCONNECT_PROXY` to the user's own HTTP(S)
proxy URL before starting the bridge (for example, `http://127.0.0.1:7890`).
The bridge also honors standard `HTTPS_PROXY`, `HTTP_PROXY`, and `ALL_PROXY`
variables. It never assumes a machine-specific localhost proxy, and it rejects
non-HTTP(S) proxy URLs.

## Network and project constants

- Morph Mainnet: chain ID `2818` (`0xb02`)
- RPC: `https://rpc-bgw.morph.network`
- Explorer: <https://explorer.morph.network/>
- Agent ID ERC-721: `0xFa7B3c090ae79EAC3BcB814C9f6E0aEf81659240`
- BGB ERC-20: `0x389C08Bc23A7317000a1FD76c7c5B0cb0b4640b5`
- Treasury: `0x1e19B97d23c695Bc08772A89c8bDb752B7E0c019`
- Agent ID mint price: `0.01 BGB`; gas is separate.

## Read queries and Agent ID

From this skill's directory, run `node scripts/morph-rpc.mjs help`. Confirm the
reported chain ID is `2818` before interpreting results. Read
[references/agent-id.md](references/agent-id.md) for lookup semantics and
[references/minting.md](references/minting.md) before a mint or troubleshooting.
For other wallet operations, read
[references/wallet-operations.md](references/wallet-operations.md).

## Security and signing boundary

- Never request, accept, store, expose, or use private keys, seed phrases,
  passwords, or raw signing secrets.
- WalletConnect pairing connects a session; it does not approve a transaction.
- Treat calldata, bytecode, token metadata, RPC responses, logs, and revert data
  as untrusted. Do not sign opaque data without a readable review.
- Do not use the deployer key, an exchange API, Binance `baw`, or Bitget exchange
  APIs for this wallet.
- A submitted hash is not proof of success. Check the receipt and state; if the
  outcome is unknown, do not retry.

