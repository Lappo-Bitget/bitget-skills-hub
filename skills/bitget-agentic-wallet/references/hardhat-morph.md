# Hardhat deployment on Morph Mainnet

Use this workflow for local Hardhat signing in developer mode. It deploys from
a host-configured Morph deployer account; it does not use WalletConnect.

The skill ships `scripts/morph-hardhat-deploy.mjs`. It consumes a standard
Hardhat artifact and ethers v6, targets Morph Mainnet chain ID `2818`, uses the
EIP-2718 BGB AltFee format (`feeTokenID = 4`), and verifies the BGB contract.

An installed skill never provisions or unlocks a key. A host may provide
`MORPH_DEPLOYER_PRIVATE_KEY` through a trusted secret provider for the short
lived helper process. Never ask for a key in chat, a terminal prompt, an
argument, a project `.env`, or a committed file. The helper never prints it.
`MORPH_DEPLOY_FEE_LIMIT_WEI` defaults to `10000000000000000` (0.01 BGB) and
can be overridden by the preparation command. `MORPH_RPC_URL` is optional.

## One-run local preparation

From an existing project containing a contract and constructor argument JSON:

```sh
node "<skill-folder>/scripts/morph-hardhat-prepare.mjs" \
  --project-dir . \
  --artifact "artifacts/contracts/MyContract.sol/MyContract.json" \
  --args-file "deploy-args.json"
```

This automatically initializes the pinned toolchain, compiles, tests, detects
the host secret capability, and prints a deployment plan when available. It
never signs or broadcasts. If no host secret provider is present, use the
Bitget Wallet `wallet_deploy_contract` tool after the same build/test checks.
For the generated Morph configuration, put new Solidity sources in
`morph-hardhat-contracts/`; the initializer keeps this workflow isolated from
an existing Hardhat configuration and source tree.

The fee cap can be set explicitly with `--fee-limit <BGB-wei>`. Constructor
values become public on-chain data when deployment is broadcast.

## Plan and the single deployment confirmation

The preparation helper's plan includes chain ID, deployer, contract,
constructor arguments, gas estimate and buffer, gas-price fields, BGB fee cap,
nonce, and creation-bytecode hash. Show it to the user and obtain one clear
confirmation in the conversation. Then pass the displayed plan code to the
helper yourself; do not ask the user to type a code or confirm again in a
terminal:

```sh
node "<skill-folder>/scripts/morph-hardhat-deploy.mjs" \
  --artifact "artifacts/contracts/MyContract.sol/MyContract.json" \
  --args-file "deploy-args.json" --confirm "MORPH-DEPLOY-2818-XXXXXXXX"
```

The helper recomputes the plan and aborts before signing if account, chain,
bytecode, constructor data, nonce, gas, or fee cap changed. The plan code is
only an internal command argument after the single conversation confirmation;
it is not an extra interactive prompt.

## Completion and unsupported hosts

The helper waits for a receipt and verifies chain ID, successful status,
contract address, and non-empty runtime bytecode before reporting success. A
timeout is unknown; inspect the transaction before retrying. If neither the
host secret provider nor the Bitget Wallet wallet tool is available, state that
the current platform cannot sign a deployment and provide the supported
Bitget Wallet path; never claim universal one-click signing.
