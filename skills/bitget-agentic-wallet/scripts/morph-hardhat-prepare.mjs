#!/usr/bin/env node
/**
 * One-shot local preparation for a Morph deployment.
 *
 * This command is intentionally limited to local setup and verification. It
 * initializes the pinned Hardhat toolchain, compiles, runs tests, and (when a
 * host secret provider is present) prints the deployment plan. It never signs
 * or broadcasts a transaction. The only approval required for a real deploy
 * is the conversation confirmation handled by morph-hardhat-deploy.mjs.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const INIT = path.join(SCRIPT_DIR, 'init-hardhat-morph.mjs');
const DEPLOY = path.join(SCRIPT_DIR, 'morph-hardhat-deploy.mjs');

function usage() {
  return `Prepare a Morph Hardhat project and preview deployment

Usage:
  node <skill>/scripts/morph-hardhat-prepare.mjs \
    --project-dir <directory> --artifact <artifact.json> \
    --args-file <constructor-args.json> [--fee-limit <BGB-wei>]

This automatically initializes the pinned toolchain, compiles, tests, and
prints a deployment plan when MORPH_DEPLOYER_PRIVATE_KEY is supplied by the
host's secret provider. It never accepts a key argument and never broadcasts.
Without a host secret provider, use the Bitget Wallet wallet_deploy_contract
path after the same compile/test checks.
`;
}

function parseArgs(argv) {
  const options = {};
  const values = new Set(['--project-dir', '--artifact', '--args-file', '--fee-limit']);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!values.has(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    const key = flag.slice(2).replaceAll('-', '');
    if (options[key]) throw new Error(`${flag} may only be used once.`);
    options[key] = value;
  }
  for (const key of ['projectdir', 'artifact', 'argsfile']) {
    if (!options[key]) throw new Error(`Missing required option: --${key === 'projectdir' ? 'project-dir' : key === 'argsfile' ? 'args-file' : key}`);
  }
  options.feelimit ||= '10000000000000000';
  if (!/^\d+$/.test(options.feelimit) || BigInt(options.feelimit) <= 0n) {
    throw new Error('--fee-limit must be a positive integer amount of BGB wei.');
  }
  return options;
}

function run(command, args, cwd, env) {
  if (process.platform === 'win32' && command === 'npm.cmd') {
    const npmCli = path.resolve(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (fs.existsSync(npmCli)) {
      const result = spawnSync(process.execPath, [npmCli, ...args], {
        cwd, env, encoding: 'utf8', stdio: 'inherit'
      });
      if (result.error || result.status !== 0) {
        throw new Error(`npm ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}.`);
      }
      return;
    }
  }
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: false
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}.`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(usage());
  const projectDir = path.resolve(opts.projectdir);
  const cleanEnv = { ...process.env, MORPH_DEPLOYER_PRIVATE_KEY: '' };
  // Installation executes only the checked-in initializer and pinned npm
  // packages. It deliberately receives an empty deploy secret.
  run(process.execPath, [INIT, '--project-dir', projectDir, '--apply'], projectDir, cleanEnv);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'morph:hardhat:compile'], projectDir, cleanEnv);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'morph:hardhat:test'], projectDir, cleanEnv);

  const hasHostSecret = Boolean(process.env.MORPH_DEPLOYER_PRIVATE_KEY?.trim());
  const status = {
    prepared: true,
    projectDir,
    compile: true,
    test: true,
    signer: {
      hostSecretProvider: hasHostSecret,
      bitgetWallet: true,
      note: hasHostSecret
        ? 'Host secret provider detected; deployment plan follows.'
        : 'No host secret provider detected; use Bitget Wallet wallet_deploy_contract. Every wallet deployment is reviewed and signed in Bitget Wallet.'
    }
  };
  console.log(JSON.stringify(status, null, 2));
  if (!hasHostSecret) return;

  const deployEnv = {
    ...process.env,
    MORPH_DEPLOY_FEE_LIMIT_WEI: opts.feelimit,
    // The helper reads this only in memory and never prints the value.
    MORPH_DEPLOYER_PRIVATE_KEY: process.env.MORPH_DEPLOYER_PRIVATE_KEY
  };
  run(process.execPath, [DEPLOY, '--artifact', opts.artifact, '--args-file', opts.argsfile, '--plan'], projectDir, deployEnv);
  console.log('After the user confirms the displayed plan in this conversation, rerun morph-hardhat-deploy.mjs with the displayed code; do not ask the user to type it or confirm again in a terminal.');
}

try {
  main();
} catch (error) {
  console.error(`Morph preparation stopped: ${error?.message || 'unknown error'}`);
  process.exitCode = 1;
}

export { parseArgs };
