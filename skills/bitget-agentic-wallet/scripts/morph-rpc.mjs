#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let ethers;
try {
  ethers = require(path.resolve(here, '../../../../agent-id-protocol/node_modules/ethers'));
} catch {
  console.error(JSON.stringify({ error: 'ethers dependency not found. Run this script from the project checkout with agent-id-protocol dependencies installed.' }));
  process.exit(2);
}

const RPC = 'https://rpc-bgw.morph.network';
const CHAIN_ID = 2818;
const AID = '0xFa7B3c090ae79EAC3BcB814C9f6E0aEf81659240';
const AID_DEPLOYMENT_BLOCK = 29752271;
const aidAbi = [
  'function tokenIdForCustomId(string) view returns (uint256)',
  'function customIdOf(uint256) view returns (string)',
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function hasMinted(address) view returns (bool)',
  'function totalMinted() view returns (uint256)',
  'function mintEnabled() view returns (bool)',
  'function MINT_PRICE() view returns (uint256)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
];
const erc20Abi = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];
const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const aid = new ethers.Contract(AID, aidAbi, provider);

function usage() {
  console.log(`Usage:
  network
  block [blockTag]
  balance <address>
  token-balance <token> <owner>
  allowance <token> <owner> <spender>
  agent-id <address>
  custom-id <text>
  tx <hash>
  receipt <hash>
  code <address>
  call <contract> <calldata> [blockTag]
  logs <contract> <fromBlock> <toBlock> [topic0]
  help`);
}
function address(value, label) {
  if (!ethers.isAddress(value)) throw new Error(`${label} is not a valid EVM address`);
  return ethers.getAddress(value);
}
function hash(value) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('transaction hash must be 32-byte hex');
  return value;
}
async function assertNetwork() {
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(CHAIN_ID)) throw new Error(`wrong chain: ${network.chainId}`);
}
async function agentIdsFor(owner) {
  const target = owner.toLowerCase();
  const topic = ethers.id('Transfer(address,address,uint256)');
  const logs = await provider.getLogs({ address: AID, topics: [topic], fromBlock: AID_DEPLOYMENT_BLOCK, toBlock: 'latest' });
  const held = new Set();
  for (const log of logs) {
    const from = ethers.getAddress(`0x${log.topics[1].slice(-40)}`).toLowerCase();
    const to = ethers.getAddress(`0x${log.topics[2].slice(-40)}`).toLowerCase();
    const tokenId = BigInt(log.topics[3]).toString();
    if (to === target) held.add(tokenId);
    if (from === target) held.delete(tokenId);
  }
  return Promise.all([...held].map(async tokenId => ({ tokenId, customId: await aid.customIdOf(tokenId), owner: await aid.ownerOf(tokenId) })));
}
async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === 'help') return usage();
  await assertNetwork();
  if (command === 'network') {
    const [block, fee] = await Promise.all([provider.getBlockNumber(), provider.getFeeData()]);
    return console.log(JSON.stringify({ rpc: RPC, chainId: CHAIN_ID, block, gasPrice: fee.gasPrice?.toString() ?? null }));
  }
  if (command === 'block') {
    const tag = args[0] || 'latest';
    const block = await provider.getBlock(tag, true);
    return console.log(JSON.stringify(block ? { number: block.number, hash: block.hash, timestamp: block.timestamp, transactions: block.transactions } : { found: false }));
  }
  if (command === 'balance') {
    const owner = address(args[0], 'address');
    return console.log(JSON.stringify({ address: owner, wei: (await provider.getBalance(owner)).toString() }));
  }
  if (command === 'token-balance') {
    const token = new ethers.Contract(address(args[0], 'token'), erc20Abi, provider);
    const owner = address(args[1], 'owner');
    const [raw, decimals, symbol] = await Promise.all([token.balanceOf(owner), token.decimals(), token.symbol().catch(() => null)]);
    return console.log(JSON.stringify({ token: token.target, owner, raw: raw.toString(), decimals: Number(decimals), symbol, formatted: ethers.formatUnits(raw, decimals) }));
  }
  if (command === 'allowance') {
    const token = new ethers.Contract(address(args[0], 'token'), erc20Abi, provider);
    const owner = address(args[1], 'owner'); const spender = address(args[2], 'spender');
    return console.log(JSON.stringify({ token: token.target, owner, spender, allowance: (await token.allowance(owner, spender)).toString() }));
  }
  if (command === 'agent-id') {
    const owner = address(args[0], 'address');
    const [hasMinted, balance, ids] = await Promise.all([aid.hasMinted(owner), aid.balanceOf(owner), agentIdsFor(owner)]);
    return console.log(JSON.stringify({ contract: AID, address: owner, hasMinted, balance: balance.toString(), ids }));
  }
  if (command === 'custom-id') {
    const customId = args.join(' ');
    if (!customId) throw new Error('custom ID is required');
    const tokenId = await aid.tokenIdForCustomId(customId);
    if (tokenId === 0n) return console.log(JSON.stringify({ customId, registered: false, tokenId: '0' }));
    return console.log(JSON.stringify({ customId, registered: true, tokenId: tokenId.toString(), owner: await aid.ownerOf(tokenId) }));
  }
  if (command === 'tx') {
    const result = await provider.getTransaction(hash(args[0]));
    return console.log(JSON.stringify(result ? { hash: result.hash, from: result.from, to: result.to, value: result.value.toString(), data: result.data, blockNumber: result.blockNumber } : { found: false }));
  }
  if (command === 'receipt') {
    const result = await provider.getTransactionReceipt(hash(args[0]));
    return console.log(JSON.stringify(result ? { hash: result.hash, status: result.status, blockNumber: result.blockNumber, gasUsed: result.gasUsed.toString(), logs: result.logs.length } : { confirmed: false }));
  }
  if (command === 'code') {
    const target = address(args[0], 'address');
    const bytecode = await provider.getCode(target);
    return console.log(JSON.stringify({ address: target, hasCode: bytecode !== '0x', bytecode }));
  }
  if (command === 'call') {
    const target = address(args[0], 'contract'); const data = args[1];
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(data || '')) throw new Error('calldata must be even-length hex starting with 0x');
    const blockTag = args[2] || 'latest';
    const result = await provider.call({ to: target, data }, blockTag);
    return console.log(JSON.stringify({ to: target, data, blockTag, result }));
  }
  if (command === 'logs') {
    const target = address(args[0], 'contract');
    const fromBlock = Number(args[1]); const toBlock = args[2] === 'latest' ? 'latest' : Number(args[2]);
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0 || !(toBlock === 'latest' || (Number.isSafeInteger(toBlock) && toBlock >= fromBlock)))
      throw new Error('provide valid fromBlock and toBlock (toBlock may be latest)');
    const topic0 = args[3];
    if (topic0 && !/^0x[0-9a-fA-F]{64}$/.test(topic0)) throw new Error('topic0 must be 32-byte hex');
    const logs = await provider.getLogs({ address: target, fromBlock, toBlock, ...(topic0 ? { topics: [topic0] } : {}) });
    return console.log(JSON.stringify({ address: target, fromBlock, toBlock, count: logs.length, logs }));
  }
  throw new Error(`unknown command: ${command}`);
}
main().catch(error => { console.error(JSON.stringify({ error: error.shortMessage || error.message || String(error) })); process.exitCode = 1; });
