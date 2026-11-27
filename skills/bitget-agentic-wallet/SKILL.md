---
name: bitget-agentic-wallet
description: >-
  Use for Bitget Wallet operations across supported EVM networks, including
  connection, status, read-only queries, and user-approved transactions on
  BNB Smart Chain, Arbitrum One, Ethereum Mainnet, Polygon PoS, Base, and
  Morph Mainnet. Morph-specific capabilities include Agent ID reads, bounded
  swaps, and Hardhat contract builds and deployments.
---

# Bitget Wallet EVM connections and Morph operations

This skill uses the `bitget-agentic-wallet` MCP tools for Bitget Wallet
connections, EVM reads, and user-approved transactions. Developer mode automatically routes signing to a
separate local automation wallet governed by an explicit bounded policy. A
WalletConnect session does not grant signing authority.

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

After developer mode is acknowledged, automatically enter the local automatic
signer flow. Call `local_signer_status`. If it reports `not_configured`, call
`local_signer_setup` immediately. That MCP tool opens the loopback-only
Bitget Wallet-styled setup window and accepts the private key only on the local
machine. After the user finishes, call `local_signer_status` again and verify
that an address is returned before any local signing operation. A DPAPI record
created by the standalone `scripts/configure-local-wallet.cmd` is not, by
itself, proof that the MCP local signer is configured. The private key must
never be entered in chat, passed as a command-line argument, or placed in a
plaintext environment variable.

Developer-mode signing uses the independent local automatic signer. Before its
first swap, call `local_signer_policy_set` with
the user-selected token pair, cumulative amount cap, per-trade cap, slippage,
duration, and fee limit. Use `local_swap_quote` and
`local_swap_execute` only while that policy is active. For Hardhat signing, use
only the host's configured secret provider to inject
`MORPH_DEPLOYER_PRIVATE_KEY` into a short-lived deployment process; never
display, persist, log, or commit it. Never batch opaque transactions or silently
enlarge limits.

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

For lightweight mode, state that Bitget Wallet is the signing device and that
each transaction is shown for approval inside the wallet app. For developer
mode, state that the independent local signer broadcasts within the active
policy and does not open a Bitget Wallet approval popup.

## Interface design baseline

All Bitget Wallet setup windows and future product artwork use the
`bitget-wallet-design` visual system. Use the current single-arrow Brand Kit
logo with its official proportions, the `#00F0FF` cyan and `#001F29` navy
palette, near-black dark surfaces, Causten Round with AlibabaPuHuiTi fallbacks,
modular cards, generous spacing, and rounded controls. Keep one clear primary
action per view and verify desktop and narrow-screen layouts before delivery.

## Actual workflows

- **Developer-mode signer setup.** Call `wallet_set_mode` with the exact user
  acknowledgement, then automatically call `local_signer_status`. If it is
  `not_configured`, launch `local_signer_setup` without asking the user to
  choose another signing path. Check status again after the local window
  reports completion. Do not call local swap tools while the status is
  `not_configured` or while a policy is absent or expired.

- **Bitget Wallet deployment gate.** When a user asks to deploy a contract and
  the Bitget Wallet signing path is selected, call
  `mcp__bitget_agentic_wallet__connect_wallet` before reporting that deployment
  preparation is complete or asking the user to scan. The tool result must
  contain a PNG `image` item. Render that returned image in the same response.
  A deployment response must never contain “scan the QR above” unless that
  image is present in the response. If the MCP tool is unavailable or returns
  no image, report the concrete setup error and stop the Bitget Wallet flow.
- **For a wallet-connection request, start the connection immediately.** Call
  the runtime's actual `connect_wallet` MCP tool from `bitget-agentic-wallet`
  (in Codex this is `mcp__bitget_agentic_wallet__connect_wallet`). A single
  WalletConnect approval must request all six supported EVM networks. If the
  user names a starting network, pass it as `network=morph`, `network=bsc`,
  `network=arbitrum`, `network=ethereum`, `network=polygon`, or `network=base`.
  If no network is named, use `network=morph`. Do not substitute shell
  commands, file reads, or a verbal claim that a QR is
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
  `wallet_status` and verify the approved address and active EVM network. Do not poll,
  check status proactively, or generate replacement QRs
  while the pairing is pending. If the user says the QR expired or cannot be
  scanned, call `connect_wallet` once with the same `network` to create a fresh
  QR and render it in that response, then wait for confirmation again.
- **For a network change after connection,** call `wallet_switch_network` with
  one of the six supported network keys. This uses the same approved session
  and must not create a second QR. Only create a new QR after the session was
  disconnected or the user explicitly asks to reconnect.
- Use `wallet_read` for the supported read-only JSON-RPC methods.
- For a Morph wallet-balance request, use the connected address and read only
  ETH, BGB, USDC, USDT0, USDe, USD1, and WETH. Take one block number with
  `eth_blockNumber` and use that block tag for `eth_getBalance` and every
  ERC-20 `balanceOf` call. For another EVM network, use its active chain and
  the token addresses selected by the user or verified for that chain. Report
  failed reads as unavailable, never as zero.
- Use `wallet_send_transaction` for lightweight-mode calls and transfers. In
  developer mode, route writes through the local signer capability exposed by
  the MCP. If that capability is unavailable, stop and report the setup gap.
 - **GetGas:** GetGas is a Bitget Wallet app-level prepaid gas account. The user
   tops it up once from Wallet > GetGas with a supported asset, then Bitget
   Wallet can use that balance to pay fees for supported transactions across
   multiple chains. For a transaction, use the normal `wallet_send_transaction`
   flow and let Bitget Wallet select GetGas. Do not replace this with a NoGas
   Swap order, do not fabricate a GetGas API, and do not pass `feeTokenID` or
   `feeLimit` as a substitute. Top-up and GetGas balance management stay inside
   the Bitget Wallet app because this skill has no public GetGas account API.
- Use `wallet_deploy_contract` only for lightweight-mode Bitget Wallet
  deployment. Developer-mode deployment requires a local signer deployment
  tool and must not fall back to a Bitget Wallet approval popup.
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

## Supported EVM networks

The connection bridge supports the following networks. Connection, status,
read-only RPC calls, and ordinary user-approved EVM transactions operate on
the active network. Agent ID, the Bitget Wallet Morph Swap API, Morph token
catalogs, and Morph Hardhat deployment remain Morph-specific.

| Key | Network | Chain ID | Native gas asset |
| --- | --- | ---: | --- |
| `morph` | Morph Mainnet | 2818 | ETH |
| `bsc` | BNB Smart Chain | 56 | BNB |
| `arbitrum` | Arbitrum One | 42161 | ETH |
| `ethereum` | Ethereum Mainnet | 1 | ETH |
| `polygon` | Polygon PoS | 137 | POL |
| `base` | Base | 8453 | ETH |

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

For developer-mode swaps, use the local automatic signer path exclusively. Use
`local_swap_quote` and `local_swap_execute`. The first execution requires an
explicit acknowledgement after showing the active policy, router, allowance,
fees, and quote. Later swaps are allowed only when the active policy still
covers the pair, amount, slippage, and expiry. Verify receipts and resulting
balances, and never retry an unknown submission.

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
