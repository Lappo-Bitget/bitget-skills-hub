# Initialize a Morph Hardhat project

Use this when the user wants a Hardhat project created or the pinned Morph
toolchain added to an existing project. The initializer scopes generated files
so it can coexist with other contracts and configurations:

- `morph.hardhat.config.cjs` (Morph Mainnet 2818 and Hoodi 2910)
- `morph-hardhat-contracts/MorphHello.sol`
- `morph-hardhat-test/MorphHello.test.cjs`
- Hardhat artifacts/cache under separate `artifacts/morph-hardhat` and
  `cache/morph-hardhat` paths

## Preview first

The user must choose an existing target project directory. Run from any working
directory with the installed skill's script path:

```sh
node "<skill-folder>/scripts/init-hardhat-morph.mjs" \
  --project-dir "<user-project-directory>" --plan
```

This is read-only. It reports the target directory, files to create, pinned
package versions, npm registry, and whether a package manifest/lockfile already
exists. Show that plan and get the user's explicit confirmation before
installing software or writing files.

## Apply the confirmed plan

After confirmation, pass the exact plan code returned by `--plan`:

```sh
node "<skill-folder>/scripts/init-hardhat-morph.mjs" \
  --project-dir "<user-project-directory>" \
  --apply --confirm "MORPH-HARDHAT-INIT-XXXXXXXX"
```

The script checks the plan again and refuses if the directory, manifest,
lockfile, package versions, or scaffold files changed. It never replaces an
existing `package.json`, lockfile, source, or config file. Same-name files with
different contents and dependency/lockfile version conflicts stop the run for
manual resolution. The generated config and source/test files use Morph-scoped
names and paths, so an unrelated Hardhat project config is left alone.

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
