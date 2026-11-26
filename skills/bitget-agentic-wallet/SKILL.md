---
name: bitget-agentic-wallet
description: >-
  Use for Bitget Wallet operations on Morph Mainnet, including Agent ID reads,
  lightweight wallet queries, user-approved transactions, developer-mode local
  automatic swaps, and Hardhat contract builds and deployments.
---

# Bitget Wallet on Morph

This skill uses the `bitget-morph-wallet` MCP tools for Bitget Wallet reads and
user-approved transactions. In developer mode, the user may separately choose
Bitget Wallet signing, a bounded local automatic swap wallet, or a local
Hardhat signer supplied by a platform secret provider. These are separate
signing paths; never silently switch between them. A WalletConnect session does
not grant signing authority.

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

Enable it when the user requests contract development or deployment, or asks
for repeated swaps under a bounded token-approval session. This mode supports:

- arbitrary contract calls and native/ERC-20 transfers;
- contract deployment transactions with creation bytecode and constructor data;
- Morph fee-token fields (`feeTokenID`, `feeLimit`) when supported by the wallet;
- a user-defined ERC-20 swap amount cap and off-chain time window for repeated
  swaps through one bounded on-chain allowance;
- local Hardhat compile/test and deployment through a configured secret provider.

Developer mode does not mean asking the user to paste a private key or seed
phrase into chat or a terminal. For Bitget Wallet signing, each transaction
remains reviewed and signed in Bitget Wallet. For local automatic swaps, use
the dedicated loopback injection flow below. For Hardhat signing, use only the
host's configured secret provider to inject `MORPH_DEPLOYER_PRIVATE_KEY` into a
short-lived deployment process; never display, persist, log, or commit it. If
the runtime has no supported local signer or secure secret-provider integration,
stop before signing and explain the limitation. Never batch opaque transactions
or silently enlarge limits.

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
show each transaction for approval inside the wallet app. A local automatic
swap session instead signs only transactions matching the user-confirmed pair,
amount limits, slippage, router, fee cap, and expiry. Never imply either path is
available when its required local MCP tools are unavailable.

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
  `wallet_status` and verify the approved address on Morph Mainnet. Do not poll,
  check status proactively, or generate replacement QRs
  while the pairing is pending. If the user says the QR expired or cannot be
  scanned, call `connect_wallet` once to create a fresh QR and render it in that
  response, then wait for confirmation again.
- Use `wallet_read` for the supported read-only JSON-RPC methods.
- For a wallet-balance request, use the connected Morph address and read only
  ETH, BGB, USDC, USDT0, USDe, USD1, and WETH. Take one block number with
  `eth_blockNumber` and use that block tag for `eth_getBalance` and every
  ERC-20 `balanceOf` call. Report failed reads as unavailable, never as zero.
- Use `wallet_send_transaction` for a call/transfer. In developer mode, `to` may
  be omitted only for contract creation and the creation bytecode must be shown.
- Use `wallet_deploy_contract` for deployment. It submits a transaction with no
  `to` field and requires the user to review/sign it in Bitget Wallet.
- For an explicitly selected Hardhat path, follow
  [references/hardhat-morph.md](references/hardhat-morph.md); do not use
  `wallet_deploy_contract` for the same deployment.
- For a request to trade without per-transaction Bitget Wallet approvals, offer
  the separate local automatic swap wallet. Explain that it has a different
  address from the connected Bitget Wallet and that its private key controls
  that wallet. The wallet must hold the input token and BGB for Morph fees.
  Never enter the key for the user.
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

- Morph Mainnet
- RPC: `https://rpc-bgw.morph.network`
- Explorer: <https://explorer.morph.network/>
- Agent ID ERC-721: `0xFa7B3c090ae79EAC3BcB814C9f6E0aEf81659240`
- BGB ERC-20: `0x389C08Bc23A7317000a1FD76c7c5B0cb0b4640b5`
- Treasury: `0x1e19B97d23c695Bc08772A89c8bDb752B7E0c019`
- Agent ID mint price: `0.01 BGB`; gas is separate.

## Morph balance catalog

When the user selects or asks for a wallet balance query, include native ETH and
all ERC-20 contracts below. The list is for read-only balance display. It does
not add any token to spending or approval presets.

| Asset | Type | Contract | Decimals |
| --- | --- | --- | ---: |
| ETH | Native gas asset | Native balance | 18 |
| USDC | ERC-20 | `0xCfb1186F4e93D60E60a8bDd997427D1F33bc372B` | 6 |
| USDT0 | ERC-20 | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | 6 |
| USDe | ERC-20 | `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34` | 18 |
| USD1 | ERC-20 | `0x111111d2bf19e43C34263401e0CAd979eD1cdb61` | 18 |
| WETH | ERC-20 | `0x5300000000000000000000000000000000000011` | 18 |
| BGB | ERC-20 | `0x389C08Bc23A7317000a1FD76c7c5B0cb0b4640b5` | 18 |

## Swap on Morph

Use Bitget Wallet's official Swap API for Morph Mainnet swaps. The API lists
Morph Chain ID 2818 as supporting Instruction Mode. It requires an API Key and
API Secret approved for the account. Keep both in server-side Cloudflare Pages
secrets only. The browser must never receive the API Secret. If credentials or
Morph access are missing, explain that and do not fall back to an unverified
router.

The local WalletConnect MCP bridge exposes `swap_quote`, `swap_approve`, and
`swap_execute`. `swap_quote` calls the shared HTTPS proxy at
`https://morph-agent-id.pages.dev/api/swap-quote`. The proxy signs requests to
`https://bopenapi.bgwapi.io` using API credentials stored in Cloudflare Pages
Secrets. Other users do not need their own API credentials. The API uses `morph`
as the chain name, the connected address as both sender and recipient,
smallest-unit integer amounts, the returned market, minimum output, and a
300-second deadline. The API represents the native token contract as an empty
string. The selector is limited to ETH, BGB, USDC, USDT0, USDe, USD1, and WETH.

If the shared proxy reports credentials are not configured or the API rejects
the account, report that response and stop. Never ask users to paste API
credentials into chat or local skill files.

Before the user signs, show the pair, amount, minimum received, slippage, market,
transaction target, value, and expiry. The quote tool checks ERC-20 allowance
and returns a one-use quote ID. In lightweight mode, if approval is needed,
show the token, exact amount, spender, network, and fees, then get clear user
confirmation before calling `swap_approve`. After the approval receipt
succeeds, request a fresh quote and get separate confirmation before
`swap_execute`.

The standard developer swap session still uses the connected Bitget Wallet.
Once the user confirms a bounded allowance and duration, the wallet must approve
that allowance and still signs each Swap transaction. Use
`swap_authorize_session` and `swap_authorization_status` for that path.

### Local automatic swap wallet

Use this separate path only when the user wants swaps without each transaction
appearing for approval in Bitget Wallet and the local signer tools are present.
It creates an independent wallet. Do not describe it as the connected Bitget
Wallet account. The injected private key gives full control of that independent
wallet, so advise a dedicated wallet with only the funds needed for the policy.

1. Enter developer mode using `wallet_set_mode` and the exact acknowledgement
   required by the tool.
2. Call `local_signer_setup` with no swap parameters and retain its returned
   loopback URL. On Windows Codex, start the installed
   `scripts/configure-local-signer.cmd` in a visible terminal and pass the URL
   returned by the tool as its argument. Open that terminal in Codex for the
   user. The script reads only the private key from the user with
   `Read-Host -AsSecureString`. Do not ask the user to copy or type the MCP
   URL. Never copy, inspect, or send the key through chat, command-line
   arguments, or another website. If local terminal execution is unavailable,
   open the returned loopback URL in the browser for local entry.
3. After the user says setup is complete, call `local_signer_status` and report
   the independent address. Wallet setup does not set a swap policy, authorize
   an allowance, or enable trading. Stop here when the user only wants wallet
   configuration.
4. Only when the user wants to trade, agree the separate policy. Show the Morph
   network, exact token pair, cumulative input cap, per-swap cap, maximum
   slippage, duration, and BGB fee limit. State that the policy duration starts
   when configured and that the first trade will also approve the cumulative
   cap. Call `local_signer_policy_set` with the confirmed values. ERC-20
   allowance has no on-chain expiry and remains after the local policy expires
   or the MCP process restarts until spent or revoked.
5. For each requested trade, call `local_swap_quote` and show the quote,
   policy headroom, and remaining allowance. On the first execution, also show
   the router, cumulative allowance, fee cap, expiry, and quote, then call
   `local_swap_execute` with
   `我确认授权已展示的本地兑换策略、路由器额度授权和本次兑换。` as the
   `authorization` value only after the user clearly confirms those details.
   This first acknowledgement authorizes the bounded local policy. Later
   user-requested swaps in that policy do not need another BGW popup or
   per-trade conversational approval. The user must still request each swap.
   Never trade in the background. Quotes are single-use, short-lived, and
   consumed before broadcast attempts. If a result is unknown, call
   `local_signer_status` and inspect the transaction before any new quote or
   retry.
6. Use `local_signer_status` to resolve pending approval, revoke, or swap
   transactions. Before calling `local_allowance_revoke`, show the token,
   router, current allowance, and fee cap, then obtain clear user confirmation.
   Verify the resulting receipt and zero allowance. `local_signer_disconnect`
   clears the signer from process memory only after the tool verifies there is
   no nonzero allowance or unresolved transaction.

The private key exists in the bridge process memory only and is not written to
disk by this flow. The HTTP page binds to `127.0.0.1` on an ephemeral port,
checks its Host and Origin, sets no-store/security headers, and accepts one
short-lived form submission. Closing the MCP process clears the in-memory
signer. The ERC-20 allowance remains on-chain and must be revoked explicitly
with the local signer or another wallet that controls the same address.

For either mode, request a fresh quote after approval, verify transaction
receipts and resulting balances, and never accept a private key in chat or retry
an unknown submission.

## Read queries and Agent ID

From this skill's directory, run `node scripts/morph-rpc.mjs help`. Confirm the
reported network is Morph Mainnet before interpreting results. Read
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
