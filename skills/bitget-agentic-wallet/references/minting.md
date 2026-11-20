# Minting and troubleshooting

Use this reference when the user plans to mint, is at a wallet prompt, or reports
a mint failure.

## User-guided mint flow

1. Open <https://morph-agent-id.pages.dev/> and connect the wallet in Bitget Wallet
   or another EVM wallet. For WalletConnect, scan the QR to connect; continue the
   mint flow in the DApp page.
2. Confirm the wallet is on Morph Mainnet (chain ID `2818`). The connected account
   must not be the project Treasury address
   `0x1e19B97d23c695Bc08772A89c8bDb752B7E0c019`.
3. Enter a 1–16 character ASCII ID matching `[A-Za-z0-9_-]`. IDs are case-sensitive.
   Query it immediately before minting; availability checks do not reserve names.
4. Check that the address has not used its one-time mint eligibility and has at
   least `0.01 BGB`. If allowance is insufficient, the wallet may ask for approval
   to the Agent ID contract. Explain the exact approval amount shown by the DApp
   and have the user inspect and approve it in their wallet.
5. Review the mint prompt: `mint(string)` on the Agent ID contract, the selected
   ID, `0.01 BGB` transferred to Treasury, and the wallet's separate Morph network
   fee. The DApp requests BGB as the gas token; the connected wallet must support
   Morph's fee-token transaction format. Have the user cancel if the destination,
   function, fee asset, or amount does not match.
6. Wait for the user-approved transaction to confirm. Verify the transaction
   receipt and the token ID/custom ID/current owner on-chain before saying it
   succeeded. A successful approval alone is not a mint.

## Diagnose common failures

- `CustomIdAlreadyUsed()` (`0x45787f88`): the custom ID is already registered;
  choose another ID. Do not assume a name is available from a stale UI check.
- `AddressAlreadyMinted()`: the connected address has already used its one-time
  mint eligibility, even if it later transferred the NFT.
- `IncorrectPaymentAmount()` (`0x6992e1ff`): on this deployment, first check
  whether the connected account equals Treasury. Treasury cannot mint because a
  self-transfer does not increase its balance by the required amount. Otherwise
  inspect the BGB token transfer behavior and the exact contract being called.
- `execution reverted (unknown custom error)` is only a generic decoder message.
  Decode the four-byte selector against the verified contract ABI or inspect the
  RPC error data; do not present the generic text as a diagnosis.
- If `eth_estimateGas` fails before a transaction hash is returned, the mint was
  not broadcast and there is no mint receipt. Do not claim a transaction was mined.
  If a hash exists, check its receipt before retrying; a failed mined transaction
  can still consume network gas.
- RPC timeout, incomplete ownership logs, or missing error data are inconclusive.
  Report the exact evidence and retry a read-only query or use Morph Explorer; do
  not tell the user to submit another mint while the transaction result is unknown.

