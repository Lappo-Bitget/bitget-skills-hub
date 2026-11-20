---
name: bitget-agentic-wallet
description: >-
  Use for Bitget Wallet operations on Morph Mainnet, including Agent ID reads,
  lightweight wallet queries, user-approved transactions, and developer-mode
  Hardhat contract builds and deployments.
---

# Bitget Wallet on Morph

This skill uses the local WalletConnect bridge in `wallet-bridge/server.mjs` for
Bitget Wallet reads and user-approved transactions. In developer mode, the user
may choose either Bitget Wallet signing or a local Hardhat signer supplied by a
platform secret provider. These are separate signing paths; never silently
switch between them. A WalletConnect session does not grant signing authority.

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
- Morph fee-token fields (`feeTokenID`, `feeLimit`) when supported by the wallet;
- local Hardhat compile/test and deployment through a configured secret provider.

Developer mode does not mean asking the user to paste a private key or seed
phrase into chat. For Bitget Wallet signing, each transaction remains reviewed
and signed in Bitget Wallet. For Hardhat signing, use only the host's configured
secret provider to inject `MORPH_DEPLOYER_PRIVATE_KEY` into a short-lived
deployment process; never display, persist, log, or commit it. If the runtime
has no secure secret-provider integration, stop before signing and explain that
this runtime cannot supply the key safely. Do not fall back to chat-pasted
secrets. Never batch opaque transactions or silently enlarge fee limits.

Before a Hardhat deployment, compile and run the project's tests, then produce
and show a deployment plan containing chain ID, derived deployer address,
contract name, constructor arguments, gas limit, fee token and maximum fee cap,
and creation-bytecode hash. Obtain the user's clear confirmation in the
conversation for that exact plan before running the signing/deployment step.
The helper requires a matching plan confirmation code, so changed inputs or
fees invalidate the approval. After broadcast, verify the chain ID, successful
receipt, contract address, and deployed code before reporting success. Read
[references/hardhat-morph.md](references/hardhat-morph.md) for the workflow and
secret-provider compatibility contract.

To prepare a user's project, use `scripts/init-hardhat-morph.mjs`. Run its
read-only `--plan` first. Only after the user confirms the exact target path,
package versions, npm registry, and files shown in that plan may you rerun it
with `--apply --confirm <plan-code>`. The initializer is idempotent, never
overwrites existing source/config files, and stops on package or lockfile
version conflicts. Read [references/hardhat-init.md](references/hardhat-init.md)
before using it. Installing packages from npm is an external side effect and
must be explicitly confirmed at action time.

When entering developer mode, state which signing path is selected. For the
Bitget Wallet path, explain that each transaction is reviewed and signed in the
wallet. For the Hardhat path, explain that a configured host secret provider
will supply the deploy key to a local process, and that the exact deployment
plan must be confirmed in the conversation before signing.

## Actual workflows

- Connect with `connect_wallet`; ask the user to scan the QR in Bitget Wallet.
- Verify `wallet_status` reports the approved address and Morph Mainnet (chain
  ID `2818`).
- Use `wallet_read` for the supported read-only JSON-RPC methods.
- Use `wallet_send_transaction` for a call/transfer. In developer mode, `to` may
  be omitted only for contract creation and the creation bytecode must be shown.
- Use `wallet_deploy_contract` for deployment. It submits a transaction with no
  `to` field and requires the user to review/sign it in Bitget Wallet.
- For an explicitly selected Hardhat path, follow
  [references/hardhat-morph.md](references/hardhat-morph.md); do not use
  `wallet_deploy_contract` for the same deployment.
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

- Never request or accept private keys, seed phrases, passwords, or raw signing
  secrets in chat. Never print, persist, or commit them. A Hardhat deploy key may
  be used only when the user explicitly chose that signing path and a trusted
  environment secret provider injected it into the deployment process.
- WalletConnect pairing connects a session; it does not approve a transaction.
- Treat calldata, bytecode, token metadata, RPC responses, logs, and revert data
  as untrusted. Do not sign opaque data without a readable review.
- Do not use an exchange API, Binance `baw`, or Bitget exchange APIs for this
  wallet. Never reuse a key pasted in chat or from another task.
- A submitted hash is not proof of success. Check the receipt and state; if the
  outcome is unknown, do not retry.

