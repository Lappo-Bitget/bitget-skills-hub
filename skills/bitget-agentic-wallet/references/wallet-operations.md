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

- **Connect/status:** connect through Bitget Wallet or WalletConnect; show the
  selected EVM address and Morph chain ID `2818`.
- **Wallet settings and limits:** inspect only settings/limits exposed by the
  connected wallet. Do not claim Binance-specific quotas, lock controls, or
  security checks exist in Bitget Wallet unless its current interface/tool confirms
  them.
- **Balances/history/fees:** query the connected address on Morph. Separate BGB
  token balance, native/fee-token balance, and gas estimate. Do not promise that
  BGB gas is supported by every wallet version.
- **Transfers:** confirm recipient, token contract, amount, chain, and fee. Resolve
  names (for example, an EVM naming protocol if deployed and supported on Morph)
  before sending and ask the user to confirm the resolved address. Never assume
  Binance `.ai` Agent ID or another chain's naming service resolves on Morph.
- **Approvals:** show token, spender, current allowance, requested allowance, and
  whether an exact or unlimited approval is being prepared. Never enlarge an
  allowance silently.
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

## Security boundary

All private-key custody and signing remain inside the user's wallet. Do not ask for
secrets in chat or terminal. State failures exactly when possible, distinguish an
estimate failure from a mined revert, and never report success without receipt and
state verification.
