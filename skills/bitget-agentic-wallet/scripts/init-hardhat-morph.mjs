#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = path.resolve(SCRIPT_DIR, '../assets/hardhat-morph');
const REGISTRY = 'https://registry.npmjs.org';
const REQUIRED_PACKAGES = Object.freeze({
  hardhat: '2.26.3',
  ethers: '6.17.0',
  '@nomicfoundation/hardhat-ethers': '3.0.8',
  '@nomicfoundation/hardhat-chai-matchers': '2.0.8',
  chai: '4.5.0'
});
const REQUIRED_SCRIPTS = Object.freeze({
  'morph:hardhat:compile': 'hardhat --config morph.hardhat.config.cjs compile',
  'morph:hardhat:test': 'hardhat --config morph.hardhat.config.cjs test'
});
const GENERATED_FILES = Object.freeze([
  ['morph.hardhat.config.cjs', 'morph.hardhat.config.cjs'],
  ['MorphHello.sol', path.join('morph-hardhat-contracts', 'MorphHello.sol')],
  ['MorphHello.test.cjs', path.join('morph-hardhat-test', 'MorphHello.test.cjs')]
]);

function usage() {
  return `Initialize an isolated Hardhat v2 project workflow for Morph

Usage:
  node <skill>/scripts/init-hardhat-morph.mjs --project-dir <existing-directory> --apply
  node <skill>/scripts/init-hardhat-morph.mjs --project-dir <existing-directory> --plan

--apply initializes immediately: it creates only Morph-scoped files and installs
missing pinned packages from ${REGISTRY}; it refuses conflicting files or versions.
--plan is an optional read-only preview. No confirmation code is required.
`;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!['--project-dir', '--plan', '--apply'].includes(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    if (flag === '--plan' || flag === '--apply') {
      if (options.mode) throw new Error('Choose exactly one of --plan or --apply.');
      options.mode = flag.slice(2);
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    i += 1;
    if (options.projectDir) throw new Error(`${flag} may only be used once.`);
    options.projectDir = value;
  }
  if (!options.projectDir || !options.mode) {
    throw new Error('Provide --project-dir and exactly one of --plan or --apply.');
  }
  return options;
}

async function readJsonIfExists(file, label) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error(`${label} is not valid JSON; refusing to modify the project.`);
    throw error;
  }
}

function getRootLockedPackage(lock, name) {
  const root = lock?.packages?.[''];
  if (root) return root.dependencies?.[name] ?? root.devDependencies?.[name];
  return lock?.dependencies?.[name]?.version;
}

function packageLocation(projectDir, name) {
  return path.join(projectDir, 'node_modules', ...name.split('/'));
}

async function getInstalledVersion(projectDir, name) {
  const packageJson = await readJsonIfExists(path.join(packageLocation(projectDir, name), 'package.json'), `${name} package metadata`);
  return packageJson?.version ?? null;
}

async function ensureProjectDirectory(projectDirInput) {
  const projectDir = path.resolve(projectDirInput);
  let stat;
  try {
    stat = await fs.stat(projectDir);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Project directory does not exist: ${projectDir}. Create/select the target directory first.`);
    throw error;
  }
  if (!stat.isDirectory()) throw new Error(`Project target is not a directory: ${projectDir}`);
  const realDir = await fs.realpath(projectDir);
  const parsed = path.parse(realDir);
  if (realDir === parsed.root) throw new Error('Refusing to initialize a filesystem root. Choose a project subdirectory.');
  return realDir;
}

async function inspectProject(projectDirInput) {
  const projectDir = await ensureProjectDirectory(projectDirInput);
  const manifestPath = path.join(projectDir, 'package.json');
  const lockPath = path.join(projectDir, 'package-lock.json');
  const manifest = await readJsonIfExists(manifestPath, 'package.json');
  const lock = await readJsonIfExists(lockPath, 'package-lock.json');
  for (const lockName of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
    try {
      await fs.lstat(path.join(projectDir, lockName));
      throw new Error(`Found ${lockName}. This initializer uses npm; choose an npm-managed project or configure the existing package manager manually.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (lock && !manifest) throw new Error('Found package-lock.json without package.json; refusing to repair or replace either file automatically.');
  if (manifest && (typeof manifest !== 'object' || Array.isArray(manifest))) {
    throw new Error('package.json must contain a JSON object.');
  }
  if (lock && (typeof lock !== 'object' || Array.isArray(lock))) throw new Error('package-lock.json must contain a JSON object.');

  const files = [];
  for (const [assetName, relativePath] of GENERATED_FILES) {
    const target = path.join(projectDir, relativePath);
    const expected = await fs.readFile(path.join(ASSET_DIR, assetName), 'utf8');
    let actual;
    try { actual = await fs.readFile(target, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (actual !== undefined && actual !== expected) {
      throw new Error(`Conflict: ${path.relative(projectDir, target)} already exists with different contents. Nothing was overwritten.`);
    }
    files.push({ path: relativePath.split(path.sep).join('/'), state: actual === undefined ? 'create' : 'already-matches' });
  }

  const scriptsToAdd = [];
  for (const [name, command] of Object.entries(REQUIRED_SCRIPTS)) {
    const existing = manifest?.scripts?.[name];
    if (existing && existing !== command) {
      throw new Error(`Conflict: package.json script ${name} already exists with a different command. Nothing was changed.`);
    }
    if (existing !== command) scriptsToAdd.push({ name, command });
  }

  const missingPackages = [];
  const packages = [];
  for (const [name, version] of Object.entries(REQUIRED_PACKAGES)) {
    const declared = manifest?.dependencies?.[name] ?? manifest?.devDependencies?.[name];
    if (declared && declared !== version) {
      throw new Error(`Conflict: package.json declares ${name}@${declared}; this workflow requires exact ${version}. Nothing was changed.`);
    }
    const locked = getRootLockedPackage(lock, name);
    if (locked && locked !== version) {
      throw new Error(`Conflict: package-lock.json locks ${name}@${locked}; this workflow requires exact ${version}. Nothing was changed.`);
    }
    if (declared && lock && locked !== version) {
      throw new Error(`Conflict: package.json pins ${name}@${version}, but package-lock.json does not contain the same root pin. Resolve the lockfile manually; nothing was changed.`);
    }
    const installed = await getInstalledVersion(projectDir, name);
    if (installed && installed !== version) {
      throw new Error(`Conflict: node_modules has ${name}@${installed}; this workflow requires exact ${version}. Nothing was changed.`);
    }
    const satisfied = installed === version && declared === version && (!lock || locked === version);
    if (!satisfied) missingPackages.push(`${name}@${version}`);
    packages.push({ name, version, state: satisfied ? 'ready' : 'install-or-align' });
  }

  const plan = {
    projectDir,
    packageManifestHash: manifest ? createHash('sha256').update(await fs.readFile(manifestPath)).digest('hex') : null,
    packageLockHash: lock ? createHash('sha256').update(await fs.readFile(lockPath)).digest('hex') : null,
    packageManifest: manifest ? 'preserve-and-add-only-pinned-dev-dependencies' : 'create-minimal-package.json',
    lockfile: lock ? 'preserve-and-update-only-if-required-package-pins-are-added' : 'npm-will-create-package-lock.json',
    registry: REGISTRY,
    installLifecycleScripts: false,
    packages,
    files,
    missingPackages,
    scriptsToAdd
  };
  return { projectDir, manifest, lock, plan, missingPackages };
}

function printPlan(result) {
  console.log('Hardhat Morph setup plan (no files written and no packages installed):');
  console.log(JSON.stringify(result.plan, null, 2));
  console.log('This preview is optional; --apply runs the same checks and initializes without a setup confirmation code.');
}

async function writeIfMissing(projectDir, relativePath, content) {
  const target = path.join(projectDir, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
    return 'created';
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await fs.readFile(target, 'utf8');
    if (existing === content) return 'already-matches';
    throw new Error(`Conflict appeared during setup: ${relativePath} now differs. It was not overwritten.`);
  }
}

async function ensurePackageManifest(projectDir, manifest) {
  if (manifest) return;
  const basename = path.basename(projectDir).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'morph-hardhat-project';
  const initial = `${JSON.stringify({ name: basename, version: '1.0.0', private: true }, null, 2)}\n`;
  await writeIfMissing(projectDir, 'package.json', initial);
}

async function addPackageScripts(projectDir) {
  const manifestPath = path.join(projectDir, 'package.json');
  const manifest = await readJsonIfExists(manifestPath, 'package.json');
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('package.json changed or became invalid during installation; add the Morph scripts manually after review.');
  }
  const scripts = { ...(manifest.scripts || {}) };
  let changed = false;
  for (const [name, command] of Object.entries(REQUIRED_SCRIPTS)) {
    if (scripts[name] && scripts[name] !== command) {
      throw new Error(`Conflict appeared during setup: package script ${name} changed. It was not overwritten.`);
    }
    if (!scripts[name]) { scripts[name] = command; changed = true; }
  }
  if (!changed) return;
  const updated = { ...manifest, scripts };
  await fs.writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
}

function verifyNetwork() {
  const args = ['ping', '--registry', REGISTRY, '--fetch-timeout=10000', '--fetch-retries=0'];
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    encoding: 'utf8',
    timeout: 15000,
    shell: process.platform === 'win32',
    env: { ...process.env, MORPH_DEPLOYER_PRIVATE_KEY: '' }
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') throw new Error('npm is not installed or not on PATH. Install Node.js/npm and rerun the setup plan.');
    throw new Error(`Could not contact ${REGISTRY}. Check network access and npm availability; no project files have been changed. (${result.error.message})`);
  }
  if (result.status !== 0) {
    throw new Error(`Could not reach npm registry ${REGISTRY}; setup cannot download pinned dependencies. Check network/proxy and retry. No project files have been changed.`);
  }
}

function installPinnedPackages(projectDir, packages) {
  if (packages.length === 0) return;
  const args = [
    'install', '--save-dev', '--save-exact', '--ignore-scripts',
    '--registry', REGISTRY, '--fetch-timeout=30000', '--fetch-retries=1', ...packages
  ];
  const env = { ...process.env, MORPH_DEPLOYER_PRIVATE_KEY: '' };
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    shell: process.platform === 'win32',
    env
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw new Error(`npm install failed against ${REGISTRY}. Check connectivity and the reported npm error, then rerun --plan. Any package-manager changes are limited to this project; existing source/config files were not overwritten.`);
  }
}

async function verifyInstalled(projectDir) {
  for (const [name, version] of Object.entries(REQUIRED_PACKAGES)) {
    const actual = await getInstalledVersion(projectDir, name);
    if (actual !== version) throw new Error(`Install verification failed: expected ${name}@${version}, found ${actual || 'not installed'}.`);
  }
}

async function applySetup(result) {
  // Network check happens before creating package.json or any scaffold files.
  if (result.missingPackages.length) verifyNetwork();
  await ensurePackageManifest(result.projectDir, result.manifest);
  installPinnedPackages(result.projectDir, result.missingPackages);
  await verifyInstalled(result.projectDir);
  await addPackageScripts(result.projectDir);

  const written = [];
  for (const [assetName, relativePath] of GENERATED_FILES) {
    const content = await fs.readFile(path.join(ASSET_DIR, assetName), 'utf8');
    written.push({ path: relativePath.split(path.sep).join('/'), state: await writeIfMissing(result.projectDir, relativePath, content) });
  }
  console.log(JSON.stringify({ initialized: true, projectDir: result.projectDir, packages: REQUIRED_PACKAGES, files: written }, null, 2));
  console.log(`Compile: npx hardhat --config morph.hardhat.config.cjs compile`);
  console.log(`Test:    npx hardhat --config morph.hardhat.config.cjs test`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(usage());
  const result = await inspectProject(options.projectDir);
  if (options.mode === 'plan') return printPlan(result);
  await applySetup(result);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Hardhat setup stopped: ${error?.message || 'unknown error'}`);
    process.exitCode = 1;
  });
}

export { parseArgs, inspectProject, writeIfMissing, applySetup, REQUIRED_PACKAGES, REQUIRED_SCRIPTS, GENERATED_FILES, REGISTRY };
