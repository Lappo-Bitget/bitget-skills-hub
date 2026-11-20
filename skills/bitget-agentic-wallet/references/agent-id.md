# Morph Agent ID lookup

Contract: `0xFa7B3c090ae79EAC3BcB814C9f6E0aEf81659240` on Morph Mainnet (chain ID
`2818`). The DApp is <https://morph-agent-id.pages.dev/>.

Use `scripts/morph-rpc.mjs custom-id <text>` to check whether a custom ID is
registered and, if so, report its token ID and current owner. A zero token ID means
unregistered at the queried block; it does not reserve the name.

Use `scripts/morph-rpc.mjs agent-id <address>` to report the address's original
mint flag and current NFT holdings. The contract allows one original mint per
address, but NFTs are transferable, so `hasMinted` and current `balance` answer
different questions. The script derives current IDs from ERC-721 Transfer logs from
deployment block `29752271`, then verifies each with `ownerOf` and `customIdOf`.
If the RPC rejects the log range or any call fails, treat the lookup as incomplete;
do not report that the wallet has no ID.

Transaction details can be checked with `tx <hash>` and `receipt <hash>`. A pending
receipt (`confirmed: false`) is not a failure or success. Only status `1` plus
matching contract state confirms a successful mint; status `0` means the transaction
reverted and gas may still have been spent.
