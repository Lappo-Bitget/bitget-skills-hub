---
name: bitget-agentic-wallet
description: >-
  Use for Bitget Wallet operations on Morph Mainnet, including Agent ID reads,
  lightweight wallet queries, user-approved transactions, and developer-mode
  Hardhat contract builds and deployments.
---

# Bitget Wallet on Morph

This skill uses the `bitget-morph-wallet` MCP tools for Bitget Wallet reads and
user-approved transactions. In developer mode, the user
may choose either Bitget Wallet signing or a local Hardhat signer supplied by a
platform secret provider. These are separate signing paths; never silently
switch between them. A WalletConnect session does not grant signing authority.

When the user asks to build or deploy a contract, enter developer mode and
start the requested work; do not ask them to repeat a mode-selection step. At
runtime, inspect available wallet tools and detect whether a trusted host
secret provider is available. Prefer the Bitget Wallet signer when present;
otherwise use Hardhat local signing only when the provider is verified. If the
host exposes neither, clearly state that this platform cannot sign/deploy and
offer the supported Bitget Wallet flow. A skill cannot install or register a
wallet integration on every agent platform by itself.

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

### Developer mode

Enable it when the user requests contract development or deployment. This mode
supports:

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

On first deployment, automatically initialize the project, install the pinned
dependencies, compile, run tests, and prepare the plan. Do not ask for a
separate initializer plan code or terminal confirmation. Inspect the checked-in
initializer source before running it; it pins dependencies, uses the public npm
registry, and disables package lifecycle scripts. Present the deployment plan
and obtain one clear confirmation in the conversation immediately before
signing/broadcast. After that confirmation, invoke the helper with the plan
code yourself; never ask the user to type the code or confirm again in a
terminal. The helper recomputes the plan, so changed inputs or fees abort
safely. Verify the
receipt, deployed address, and code before reporting success. Read
[references/hardhat-morph.md](references/hardhat-morph.md) and
[references/hardhat-init.md](references/hardhat-init.md).

Use `scripts/morph-hardhat-prepare.mjs` for a one-run initialization, compile,
test, signer detection, and deployment-plan preview. Run
`scripts/init-hardhat-morph.mjs --project-dir <existing-project> --apply`
directly only when a blank project needs setup before contract source is ready.
The optional `--plan` is read-only. Initialization is idempotent, does not
overwrite files, blocks version conflicts, and uses `npm --ignore-scripts`.

State which signing path the current platform exposes. Bitget Wallet must still
show the transaction for user approval inside the wallet app. The single
conversation confirmation authorizes submission; wallet approval remains the
wallet's security boundary. For Hardhat, the configured host secret provider
supplies the key to the local process. Never imply signing works on hosts where
the required wallet tool or secure provider is unavailable.

## Actual workflows

- **Bitget Wallet deployment gate.** When a user asks to deploy a contract and
  the Bitget Wallet signing path is selected, call
  `mcp__bitget_morph_wallet__connect_wallet` before reporting that deployment
  preparation is complete or asking the user to scan. The tool result must
  contain a PNG `image` item. Render that returned image in the same response.
  A deployment response must never contain “scan the QR above” unless that
  image is present in the response. If the MCP tool is unavailable or returns
  no image, report the concrete setup error and stop the Bitget Wallet flow.
- **For a wallet-connection request, start the connection immediately.** Use
  the runtime's actual `connect_wallet` MCP tool from `bitget-morph-wallet`
  (in Codex this is `mcp__bitget_morph_wallet__connect_wallet`);
  do not substitute shell commands, file reads, or a verbal claim that a QR is
  ready. This is a lightweight wallet action and does not require developer
  mode. The call returns a high-resolution PNG image and a WalletConnect URI.
  Render the returned PNG in the same response so the user can scan it directly
  in Bitget Wallet. In Codex, when `mcp__codex_app__open_in_codex` is available,
  immediately open the saved absolute PNG path with target type `file` and
  placement `right`, keeping the QR visible in the right panel. Do not
  automatically open the URI, navigate to a website, or make the user open a
  local QR file. The URI and saved PNG path are fallback
  details only when the client cannot render the image. Never say “scan the QR
  above” unless the QR image is actually present in the response. If the first
  tool result lacks an image, is an error, or the tool is unavailable, state that
  connection has not started and give the concrete error/setup requirement. Do
  not call `wallet_status` in the same turn as `connect_wallet`.
- **Wait for explicit user confirmation before checking status.** After the QR
  response, wait for a later user message that clearly confirms the wallet is
  connected, such as “确认连接好了”. A message that merely requests
  connection or says the QR was displayed is not confirmation. Only then call
  `wallet_status` and verify the approved address on Morph Mainnet (chain ID
  `2818`). Do not poll, check status proactively, or generate replacement QRs
  while the pairing is pending. If the user says the QR expired or cannot be
  scanned, call `connect_wallet` once to create a fresh QR and render it in that
  response, then wait for confirmation again.
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

