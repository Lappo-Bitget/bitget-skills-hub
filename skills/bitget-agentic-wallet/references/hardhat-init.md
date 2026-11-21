# Initialize a Morph Hardhat project

Use this when the user wants a Hardhat project created or the pinned Morph
toolchain added to an existing project. The initializer scopes generated files
so it can coexist with other contracts and configurations:

- `morph.hardhat.config.cjs` (Morph Mainnet 2818 and Hoodi 2910)
- `morph-hardhat-contracts/MorphHello.sol`
- `morph-hardhat-test/MorphHello.test.cjs`
- Hardhat artifacts/cache under separate `artifacts/morph-hardhat` and
  `cache/morph-hardhat` paths

## Automatic setup

Use an existing user project directory. For a new project, ask for a project
location only when no working directory is already available. The normal
developer workflow runs the initializer automatically through
`morph-hardhat-prepare.mjs`; a separate plan step is optional, not a required
approval gate. Direct setup:

```sh
node "<skill-folder>/scripts/init-hardhat-morph.mjs" \
  --project-dir "<user-project-directory>" --apply
```

This creates only Morph-scoped files and installs pinned dependencies without a
setup confirmation code. Before executing, inspect this checked-in script and
confirm its dependency sources and behavior are trusted. It targets the public
npm registry, disables npm lifecycle scripts, and never handles signing keys.
The user has authorized project setup as part of the requested developer-mode
workflow; reserve the single conversation confirmation for the actual
deployment plan.

## Optional read-only preview

```sh
node "<skill-folder>/scripts/init-hardhat-morph.mjs" \
  --project-dir "<user-project-directory>" --plan
```

Use this only when you need to inspect exactly what the initializer will do.
There is no plan code or additional confirmation step. The apply operation
rechecks the target directory and refuses package/lock conflicts. It never
replaces an existing `package.json`, lockfile, source, or config file. The
generated config and source/test files use Morph-scoped names and paths, so an
unrelated Hardhat project config is left alone.

If `package.json` is missing, the script creates a minimal private package
manifest. If `package-lock.json` already exists, it checks root dependency pins
and preserves it through npm's normal update. An orphaned lockfile or a stale
pin for one of the required packages is a conflict and causes an abort.

## Package installation and offline behavior

The installer pins the following development dependencies:

| Package | Version |
| --- | --- |
| `hardhat` | `2.26.3` |
| `ethers` | `6.17.0` |
| `@nomicfoundation/hardhat-ethers` | `3.0.8` |
| `@nomicfoundation/hardhat-chai-matchers` | `2.0.8` |
| `chai` | `4.5.0` |

Packages come from the public npm registry at `https://registry.npmjs.org/`.
Before changing project files, the script checks that npm exists and can reach
that registry. It runs `npm install --save-dev --save-exact --ignore-scripts`
with the pinned package versions, so third-party lifecycle scripts are not
executed. If offline, npm is unavailable, a package conflicts with the project,
or installation fails, the script prints a specific error and stops. It never
switches registries or uses a project/global Hardhat version outside the pins.

## Dependency audit snapshot

The tested pinned toolchain (`hardhat@2.26.3`, ethers `6.17.0`, plugins
`3.0.8/2.0.8`, chai `4.5.0`) reported 18 npm audit findings in the development
dependency tree (10 low, 2 moderate, 6 high); `npm audit --omit=dev` reported
zero production findings. These include transitive development packages, not
the skill's wallet bridge runtime. An isolated check of Hardhat `2.29.2`
reported 19 findings and did not reduce the count. Hardhat 3 requires a plugin
and config migration that has not been verified here, so the tested v2 pins
remain. Re-run `npm audit` against the generated lockfile before a production
project adopts this toolchain; do not apply `npm audit fix --force` blindly.

## Compile and test

Run these commands in the target project directory:

```sh
npx hardhat --config morph.hardhat.config.cjs compile
npx hardhat --config morph.hardhat.config.cjs test
```

The dedicated config routes only the generated sample contract and smoke test;
it does not alter `hardhat.config.*`, existing contracts, test folders, or
package scripts. Morph Mainnet RPC can be overridden with `MORPH_RPC_URL`;
Hoodi RPC can be overridden with `MORPH_HOODI_RPC_URL`. Neither network config
contains signing keys. Read [hardhat-morph.md](hardhat-morph.md) for the
separate, explicitly confirmed deployment workflow.
