# Hardhat deployment on Morph Mainnet

Use this workflow only when the user explicitly chooses local Hardhat signing in
developer mode. It deploys from a separately configured Morph deployer account;
it does not use WalletConnect or ask Bitget Wallet to sign the transaction.

## Compatibility boundary

The skill ships `scripts/morph-hardhat-deploy.mjs`. It consumes standard
Hardhat artifact JSON and ethers v6 from the current project's `node_modules`.
The project must have a working Hardhat compile/test setup and ethers v6
installed. The helper targets Morph Mainnet only (chain ID 2818), uses Morph's
EIP-2718 BGB AltFee transaction format (`feeTokenID = 4`), and verifies the BGB
token contract before deployment.

An installed skill does not provision or unlock a signing key. Each agent host
must provide a trusted secret-provider integration that injects
`MORPH_DEPLOYER_PRIVATE_KEY` only into the short-lived helper process. There is
no platform-neutral secret-provider API that every agent can call. If the host
cannot provide this secure environment injection, stop before signing and use
the Bitget Wallet deployment path instead. Never ask for the key in chat, a
terminal prompt, command argument, project `.env`, or committed file. Do not
reuse a key previously pasted in chat. The script intentionally accepts no
private-key CLI argument and never prints the secret.

The environment must also set `MORPH_DEPLOY_FEE_LIMIT_WEI` to an explicit BGB
maximum in wei. `MORPH_RPC_URL` is optional and defaults to the public Morph
Mainnet RPC. The configured fee cap is checked against the deployer's BGB
balance and is shown in the plan.

## Build and test

Run these commands from the user's Hardhat project root. Do not copy the
project's deployment script or secrets into the installed skill.

```sh
npx hardhat compile
npx hardhat test
```

Choose the built artifact and write the constructor arguments as a JSON array in
a project-local file, for example `deploy-args.json`. Values must match the
artifact ABI; JSON strings can represent Solidity addresses, strings, and
large integer values. Constructor values become public on-chain data when the
deployment is broadcast.

## Preview and confirmation

Use the configured host secret provider to inject the deploy key and fee cap
into each helper invocation; do not print or persist them. Replace the artifact
path, argument file, and skill path with the actual paths:

```sh
node "<skill-folder>/scripts/morph-hardhat-deploy.mjs" \
  --artifact "artifacts/contracts/MyContract.sol/MyContract.json" \
  --args-file "deploy-args.json" --plan
```

The plan command reads the deploy key only to derive the account address. It
does not sign or send a transaction. Show the returned plan to the user and
obtain a clear confirmation in the conversation for that exact plan. The plan
includes chain ID, deployer, contract and constructor arguments, estimated and
buffered gas, gas-price fields, BGB fee cap, nonce, and creation-bytecode hash.

Only after the user confirms, rerun through the same secret provider with the
displayed confirmation code:

```sh
node "<skill-folder>/scripts/morph-hardhat-deploy.mjs" \
  --artifact "artifacts/contracts/MyContract.sol/MyContract.json" \
  --args-file "deploy-args.json" --confirm "MORPH-DEPLOY-2818-XXXXXXXX"
```

The helper recomputes the plan before signing. If the account, chain, bytecode,
constructor data, nonce, gas parameters, or fee cap changed, the confirmation
code will differ and the helper stops without broadcasting. Present the new
plan and obtain fresh confirmation before trying again.

## Completion checks

The helper waits for a receipt, verifies chain ID 2818, successful status,
contract address, and non-empty runtime bytecode. Report the transaction hash,
deployed address, and returned Morph Explorer links. A timeout is an unknown
outcome: check the transaction/receipt before considering any retry. Never
report deployment success based only on a transaction hash.

The secret-provider adapter is host-specific. Configure it outside the skill
and make it inject the named environment variable without returning secret
contents to the agent or logs. Do not claim automatic signing is available on
Codex, another agent, a cloud runner, or a local machine until that host's
secret-provider integration has been configured and verified.
