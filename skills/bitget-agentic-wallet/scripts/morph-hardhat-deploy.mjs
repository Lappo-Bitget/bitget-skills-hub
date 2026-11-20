#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const DEFAULT_RPC = 'https://rpc-bgw.morph.network';
const CHAIN_ID = 2818n;
const FEE_TOKEN_ID = 4n;
const BGB_TOKEN = '0x389C08Bc23A7317000a1FD76c7c5B0cb0b4640b5';
const EXPLORER = 'https://explorer.morph.network';

function usage() {
  return `Morph Mainnet Hardhat artifact deploy helper

Usage:
  node <skill>/scripts/morph-hardhat-deploy.mjs --artifact <Hardhat-artifact.json> --args-file <constructor-args.json> --plan
  node <skill>/scripts/morph-hardhat-deploy.mjs --artifact <Hardhat-artifact.json> --args-file <constructor-args.json> --confirm <plan-code>

Required environment (injected by the host's secret provider):
  MORPH_DEPLOYER_PRIVATE_KEY  Never pass this value as an argument or print it.
  MORPH_DEPLOY_FEE_LIMIT_WEI  Maximum BGB fee limit in wei, e.g. 10000000000000000.
Optional environment:
  MORPH_RPC_URL               Defaults to ${DEFAULT_RPC}
`;
}

function parseCli(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!['--artifact', '--args-file', '--plan', '--confirm'].includes(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    if (flag === '--plan') {
      if (opts.plan || opts.confirm) throw new Error('Choose either --plan or --confirm.');
      opts.plan = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    i += 1;
    if (flag === '--confirm') {
      if (opts.plan || opts.confirm) throw new Error('Choose either --plan or --confirm.');
      opts.confirm = value;
    } else {
      const key = flag === '--artifact' ? 'artifact' : 'argsFile';
      if (opts[key]) throw new Error(`Option ${flag} may only be used once.`);
      opts[key] = value;
    }
  }
  if (!opts.artifact || !opts.argsFile || (!opts.plan && !opts.confirm)) {
    throw new Error('Provide --artifact, --args-file, and exactly one of --plan or --confirm.');
  }
  return opts;
}

function quantity(ethers, value) {
  const hex = ethers.toBeHex(value);
  return hex === '0x00' ? '0x' : hex;
}

function getEthers() {
  const projectPackage = path.resolve(process.cwd(), 'package.json');
  let projectRequire;
  try {
    projectRequire = createRequire(projectPackage);
    return projectRequire('ethers');
  } catch {
    throw new Error('Could not load ethers from the current Hardhat project. Install ethers v6 in that project and run this helper from its root.');
  }
}

async function loadInputs(ethers, opts) {
  const artifactPath = path.resolve(process.cwd(), opts.artifact);
  const argsPath = path.resolve(process.cwd(), opts.argsFile);
  let artifact;
  let args;
  try {
    artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
  } catch {
    throw new Error('Could not read the Hardhat artifact or constructor argument JSON.');
  }
  if (!artifact || typeof artifact.contractName !== 'string' || !Array.isArray(artifact.abi)) {
    throw new Error('Artifact must be a Hardhat artifact with contractName and abi fields.');
  }
  if (!Array.isArray(args)) throw new Error('Constructor argument file must contain a JSON array.');
  if (typeof artifact.bytecode !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(artifact.bytecode)) {
    throw new Error('Artifact creation bytecode is empty or contains unresolved library references.');
  }
  const constructorData = new ethers.Interface(artifact.abi).encodeDeploy(args);
  const bytecode = artifact.bytecode;
  const initCode = `${bytecode}${constructorData.slice(2)}`;
  return { artifact, args, bytecode, constructorData, initCode };
}

function loadSigner(ethers) {
  const secret = process.env.MORPH_DEPLOYER_PRIVATE_KEY;
  if (!secret) throw new Error('MORPH_DEPLOYER_PRIVATE_KEY is unavailable. Configure a host secret provider; never paste the key into chat.');
  try {
    const normalized = secret.trim().startsWith('0x') ? secret.trim() : `0x${secret.trim()}`;
    return new ethers.Wallet(normalized);
  } catch {
    throw new Error('MORPH_DEPLOYER_PRIVATE_KEY is invalid. The secret value was not displayed.');
  }
}

async function getPlan(ethers, provider, signer, loaded) {
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`Refusing deployment: RPC chain ID is ${network.chainId}; Morph Mainnet must be ${CHAIN_ID}.`);
  }

  const feeLimitText = process.env.MORPH_DEPLOY_FEE_LIMIT_WEI;
  if (!feeLimitText || !/^\d+$/.test(feeLimitText)) {
    throw new Error('Set MORPH_DEPLOY_FEE_LIMIT_WEI to an explicit maximum BGB fee in wei.');
  }
  const feeLimit = BigInt(feeLimitText);
  if (feeLimit <= 0n) throw new Error('MORPH_DEPLOY_FEE_LIMIT_WEI must be greater than zero.');

  const bgbCode = await provider.getCode(BGB_TOKEN);
  if (bgbCode === '0x') throw new Error(`Morph BGB contract has no code at ${BGB_TOKEN}.`);
  const bgb = new ethers.Contract(BGB_TOKEN, [
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address) view returns (uint256)'
  ], provider);
  const [symbol, decimals, bgbBalance] = await Promise.all([
    bgb.symbol(), bgb.decimals(), bgb.balanceOf(signer.address)
  ]);
  if (symbol !== 'BGB' || decimals !== 18n) {
    throw new Error(`Unexpected Morph fee-token metadata: ${symbol}/${decimals}.`);
  }
  if (bgbBalance < feeLimit) {
    throw new Error(`Deployer BGB balance (${ethers.formatUnits(bgbBalance, 18)}) is below the configured fee cap (${ethers.formatUnits(feeLimit, 18)} BGB).`);
  }

  const [nonce, gasPriceHex, priorityHex] = await Promise.all([
    provider.getTransactionCount(signer.address, 'pending'),
    provider.send('eth_gasPrice', []),
    provider.send('eth_maxPriorityFeePerGas', [])
  ]);
  const maxFeePerGas = BigInt(gasPriceHex);
  const maxPriorityFeePerGas = BigInt(priorityHex);
  const feeLimitHex = ethers.toQuantity(feeLimit);
  const estimate = BigInt(await provider.send('eth_estimateGas', [{
    from: signer.address,
    maxFeePerGas: ethers.toQuantity(maxFeePerGas),
    maxPriorityFeePerGas: ethers.toQuantity(maxPriorityFeePerGas),
    value: '0x0',
    data: loaded.initCode,
    feeTokenID: ethers.toQuantity(FEE_TOKEN_ID),
    feeLimit: feeLimitHex
  }]));
  const gasLimit = (estimate * 120n + 99n) / 100n;

  const plan = {
    chainId: CHAIN_ID.toString(),
    deployer: signer.address,
    contract: loaded.artifact.contractName,
    constructorArgs: loaded.args,
    gasLimit: gasLimit.toString(),
    estimatedGas: estimate.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    feeToken: 'BGB',
    feeTokenID: FEE_TOKEN_ID.toString(),
    maxFee: `${ethers.formatUnits(feeLimit, 18)} BGB`,
    feeLimitWei: feeLimit.toString(),
    nonce,
    creationBytecodeHash: ethers.keccak256(loaded.bytecode),
    constructorDataHash: ethers.keccak256(loaded.constructorData),
    initCodeHash: ethers.keccak256(loaded.initCode)
  };
  const digest = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(plan)));
  const confirmationCode = `MORPH-DEPLOY-${CHAIN_ID}-${digest.slice(2, 10).toUpperCase()}`;
  return { plan, confirmationCode, feeLimit, maxFeePerGas, maxPriorityFeePerGas, gasLimit, nonce };
}

function printPlan(plan, confirmationCode) {
  console.log('Deployment plan (no transaction has been signed or sent):');
  console.log(JSON.stringify(plan, null, 2));
  console.log(`Confirmation code: ${confirmationCode}`);
  console.log('Show this complete plan to the user and obtain explicit conversation confirmation before continuing.');
}

async function signAndBroadcast(ethers, provider, signer, loaded, prepared) {
  const { feeLimit, maxFeePerGas, maxPriorityFeePerGas, gasLimit, nonce } = prepared;
  const unsigned = [
    quantity(ethers, CHAIN_ID), quantity(ethers, BigInt(nonce)),
    quantity(ethers, maxPriorityFeePerGas), quantity(ethers, maxFeePerGas),
    quantity(ethers, gasLimit), '0x', quantity(ethers, 0n), loaded.initCode, [],
    quantity(ethers, FEE_TOKEN_ID), quantity(ethers, feeLimit)
  ];
  const signingHash = ethers.keccak256(ethers.concat(['0x7f', ethers.encodeRlp(unsigned)]));
  const signature = signer.signingKey.sign(signingHash);
  const signed = [...unsigned,
    quantity(ethers, BigInt(signature.yParity)),
    quantity(ethers, BigInt(signature.r)), quantity(ethers, BigInt(signature.s))
  ];
  const rawTransaction = ethers.concat(['0x7f', ethers.encodeRlp(signed)]);
  const txHash = await provider.send('eth_sendRawTransaction', [rawTransaction]);
  return txHash;
}

async function waitForReceipt(provider, hash, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await provider.send('eth_getTransactionReceipt', [hash]);
    if (receipt) return receipt;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for a receipt. Check transaction ${hash}; do not resubmit unless its status is known.`);
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  if (opts.help) return console.log(usage());
  const ethers = getEthers();
  const loaded = await loadInputs(ethers, opts);
  const signer = loadSigner(ethers);
  const provider = new ethers.JsonRpcProvider(process.env.MORPH_RPC_URL || DEFAULT_RPC, Number(CHAIN_ID));
  try {
    const prepared = await getPlan(ethers, provider, signer, loaded);
    if (opts.plan) {
      printPlan(prepared.plan, prepared.confirmationCode);
      return;
    }
    if (opts.confirm !== prepared.confirmationCode) {
      printPlan(prepared.plan, prepared.confirmationCode);
      throw new Error('Confirmation code does not match the current plan. No transaction was signed or sent. Re-review the plan and obtain fresh user confirmation.');
    }

    const before = await provider.getNetwork();
    if (before.chainId !== CHAIN_ID) throw new Error('RPC chain changed before signing; refusing deployment.');
    const currentNonce = await provider.getTransactionCount(signer.address, 'pending');
    if (currentNonce !== prepared.nonce) throw new Error('Deployer pending nonce changed since the plan was prepared; refusing deployment. Rebuild the plan and obtain fresh confirmation.');
    console.log(`Signing and broadcasting the confirmed Morph deployment from ${signer.address}.`);
    const transactionHash = await signAndBroadcast(ethers, provider, signer, loaded, prepared);
    const receipt = await waitForReceipt(provider, transactionHash);
    const after = await provider.getNetwork();
    if (after.chainId !== CHAIN_ID) throw new Error(`Receipt was returned by unexpected chain ${after.chainId}; verify manually before reporting success.`);
    if (receipt.status !== '0x1' || !receipt.contractAddress) {
      throw new Error(`Deployment receipt failed or has no contract address. Transaction: ${EXPLORER}/tx/${transactionHash}`);
    }
    const runtimeCode = await provider.getCode(receipt.contractAddress);
    if (runtimeCode === '0x') throw new Error(`Receipt has a contract address but no deployed code: ${receipt.contractAddress}`);
    console.log(JSON.stringify({
      deployed: true,
      chainId: after.chainId.toString(),
      deployer: signer.address,
      contract: loaded.artifact.contractName,
      contractAddress: receipt.contractAddress,
      transactionHash,
      receiptStatus: receipt.status,
      blockNumber: receipt.blockNumber,
      runtimeBytecodeHash: ethers.keccak256(runtimeCode),
      explorerAddress: `${EXPLORER}/address/${receipt.contractAddress}`,
      explorerTransaction: `${EXPLORER}/tx/${transactionHash}`
    }, null, 2));
  } finally {
    provider.destroy();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Deployment helper stopped: ${error?.message || 'unknown error'}`);
    process.exitCode = 1;
  });
}

export { parseCli, quantity, loadInputs, getPlan };
