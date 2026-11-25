# Wallet operations on Morph

Use this reference whenever the user asks for a wallet capability beyond Agent ID.

## Routing

1. Identify the requested operation: connection/status, chain, balance, history,
   fee, transfer, approval, swap/quote, conditional order, contract call/signature,
   pending transaction, DeFi, prediction market, or x402.
2. Check whether a Morph-compatible tool or named protocol is available in this
   session. Read its current guide or documentation for exact parameters. Never
   invent a CLI command, operation ID, contract address, route, or supported venue.
3. For a read, query the provider/RPC and state the block or freshness when it matters.
4. For a write, prepare a wallet transaction and show its complete review details.
   The user confirms in Bitget Wallet; the wallet supplies gas and signs/broadcasts.
5. Verify the receipt and resulting state. If no hash exists, nothing has been
   broadcast. If the result is unknown, look up the transaction before retrying.

## Capability notes

- **Connect/status:** connect through Bitget Wallet or WalletConnect and show the
  selected EVM address on Morph Mainnet.
- **Wallet settings and limits:** inspect only settings/limits exposed by the
  connected wallet. Do not claim Binance-specific quotas, lock controls, or
  security checks exist in Bitget Wallet unless its current interface/tool confirms
  them.
- **Balances/history/fees:** for a balance query, read only ETH, BGB, USDC,
  USDT0, USDe, USD1, and WETH from the Morph balance catalog in the skill. Pin
  reads to one Morph block. Show individual read failures as unavailable, never
  as zero. Keep balances separate from gas estimates and permission-account
  funds. Do not promise that BGB gas is supported by every wallet version.
- **Transfers:** confirm recipient, token contract, amount, chain, and fee. Resolve
  names (for example, an EVM naming protocol if deployed and supported on Morph)
  before sending and ask the user to confirm the resolved address. Never assume
  Binance `.ai` Agent ID or another chain's naming service resolves on Morph.
- **Approvals:** show token, spender, current allowance, requested allowance, and
  whether an exact or unlimited approval is being prepared. Never enlarge an
  allowance silently.
- **Developer swap sessions:** after explicit developer-mode acknowledgement,
  the connected Bitget Wallet path supports one bounded ERC-20 allowance with a
  user-selected cumulative amount cap and duration up to seven days. The bridge
  enforces the time window and amount cap off-chain while the token contract
  enforces the allowance. ERC-20 allowance has no native expiry, so explain
  that unused allowance remains until spent or revoked. Every swap transaction
  still needs Bitget Wallet signing on this path.
- **Local automatic swap sessions:** when the user explicitly requests no
  per-transaction Bitget Wallet approvals, use the separate local signer path.
  Call `local_signer_setup`, open its loopback URL, and have the user enter a
  dedicated automation-wallet key directly in that local page. The bridge keeps
  the key in process memory, applies the selected pair, cumulative cap,
  per-trade cap, slippage, router, fee, and expiry policy, and signs the first
  approval plus later swaps locally. The local signer address is distinct from
  the connected Bitget Wallet address. Call `local_signer_status` for pending
  transaction resolution and `local_allowance_revoke` to remove the on-chain
  allowance. Never accept this key in chat or terminal input.
- **Swaps and quotes:** use a Morph-supported DEX or aggregator only after checking
  live availability, route, slippage, minimum received, and fee. A quote is not an
  order. Support market swaps and limit/trigger orders only when an available Morph
  venue explicitly offers them; otherwise explain that execution venue is missing.
  Do not silently turn a trigger into an immediate swap.
- **Contracts and signatures:** explain the target, selector/function, calldata or
  typed message, value, and risk. Do not sign opaque data without a readable review.
- **Pending transactions:** inspect receipt/status and nonce before replacement or
  cancellation. Replacement requires an explicit user request and wallet review.
- **Transaction history/order management:** distinguish confirmed chain transactions
  from DEX orders and wallet activity. Query each from its actual data source; chain
  history alone does not prove the state of an off-chain or protocol order.
- **DeFi, prediction, and x402:** route only to a verified Morph-compatible
  protocol/tool. If none is available, say that the category is not currently
  executable here rather than routing to Binance or Bitget exchange APIs.

## Morph balance catalog

When the user selects or asks for a wallet balance query, include only the
following assets. The list is for read-only balance display and does not add any
token to spending or approval presets.

| Asset | Type | Contract | Decimals |
| --- | --- | --- | ---: |
| ETH | Native gas asset | Native balance | 18 |
| BGB | ERC-20 | `0x389C08Bc23A7317000a1FD76c7c5B0cb0b4640b5` | 18 |
| USDC | ERC-20 | `0xCfb1186F4e93D60E60a8bDd997427D1F33bc372B` | 6 |
| USDT0 | ERC-20 | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | 6 |
| USDe | ERC-20 | `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34` | 18 |
| USD1 | ERC-20 | `0x111111d2bf19e43C34263401e0CAd979eD1cdb61` | 18 |
| WETH | ERC-20 | `0x5300000000000000000000000000000000000011` | 18 |

Read all seven assets at one block. If an individual RPC or token read fails,
show that asset as unavailable and do not substitute zero.

## Security boundary

All private-key custody and signing remain inside the user's wallet. Do not ask for
secrets in chat or terminal. State failures exactly when possible, distinguish an
estimate failure from a mined revert, and never report success without receipt and
state verification.

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
and returns a one-use quote ID. In lightweight mode, use `swap_approve` only
after clear confirmation for the exact amount. In developer mode, show the
chosen input token, spender, cumulative amount cap, duration, and the lack of
on-chain expiry, then call `swap_authorize_session` once after clear
confirmation. Verify it with `swap_authorization_status`. Active sessions may
submit later quotes for the same token and spender without another
conversation-level authorization prompt until the cap or time window is
exhausted. Bitget Wallet still asks the user to sign each transaction on this
path. Local automatic sessions require a fresh quote for each user-requested
swap, consume the quote before broadcast attempts, verify receipts through
`local_signer_status`, and never retry an unknown submission.
