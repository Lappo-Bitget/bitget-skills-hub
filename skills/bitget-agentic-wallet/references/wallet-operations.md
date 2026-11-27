# Wallet operations across supported EVM networks

Use this reference whenever the user asks for a wallet capability beyond Agent ID.

## Routing

1. Identify the requested operation: connection/status, chain, balance, history,
   fee, transfer, approval, swap/quote, conditional order, contract call/signature,
   pending transaction, DeFi, prediction market, or x402.
2. For connection, status, read-only RPC calls, and ordinary EVM transactions,
   use the currently active supported network. For Agent ID, swaps, and
   Morph-specific deployment workflows, check whether a Morph-compatible tool
   or named protocol is available in this session. Read its current guide or
   documentation. Never invent a CLI command, operation ID, contract address,
   route, or supported venue.
3. For a read, query the provider/RPC and state the block or freshness when it matters.
4. For a write, prepare a wallet transaction and show its complete review details.
   The user confirms in Bitget Wallet; the wallet supplies gas and signs/broadcasts.
5. Verify the receipt and resulting state. If no hash exists, nothing has been
   broadcast. If the result is unknown, look up the transaction before retrying.

## Capability notes

- **Connect/status:** connect through Bitget Wallet or WalletConnect with one of
  `morph`, `bsc`, `arbitrum`, `ethereum`, `polygon`, or `base`, then show the
  selected EVM address and active network. Use `wallet_switch_network` for a
  network change in an existing session.
- **Wallet settings and limits:** inspect only settings/limits exposed by the
  connected wallet. Do not claim Binance-specific quotas, lock controls, or
  security checks exist in Bitget Wallet unless its current interface/tool confirms
  them.
- **Balances/history/fees:** on Morph, read only ETH, BGB, USDC, USDT0, USDe,
  USD1, and WETH from the Morph balance catalog in the skill. On another
  supported EVM network, use the selected network and token addresses supplied
  or verified for that network. Pin a multi-asset read to one block. Show
  individual read failures as unavailable, never as zero. Keep balances
  separate from gas estimates and permission-account funds.
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

The catalog below is Morph-specific. For another supported EVM network, query
the native balance or an explicitly supplied ERC-20 contract on the active
network.

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

The local WalletConnect MCP bridge exposes `swap_quote`, `swap_approve`,
`swap_execute`, and `get_gas`. `swap_quote` calls the shared HTTPS proxy at
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

`get_gas` is the official Bitget Wallet NoGas Order Mode. It is a sponsored
swap path rather than a native-token faucet. Use it for stablecoin pairs only.
The bridge checks `getSwapPrice.features` for `no_gas`, creates
`makeSwapOrder(feature: "no_gas")`, displays the returned EIP-712 hashes, and
then uses `swap_execute` to sign each hash with `eth_sign` and call
`submitSwapOrder`. No native gas balance or ERC-20 approval is required when
the official quote supports this feature. If the feature is absent, report that
NoGas is unavailable for the pair.

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
path. Request a fresh quote for each user-requested swap, verify receipts,
and never retry an unknown submission.
