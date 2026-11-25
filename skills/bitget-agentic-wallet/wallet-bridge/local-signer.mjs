import {
  Wallet,
  concat,
  encodeRlp,
  keccak256,
  toBeHex,
  toQuantity
} from 'ethers';

export const MORPH_CHAIN_ID = 2818n;
export const MORPH_FEE_TOKEN_ID = 4n;

function quantity(value) {
  const encoded = toBeHex(value);
  return encoded === '0x00' ? '0x' : encoded;
}

export function createLocalSigner(privateKey) {
  if (typeof privateKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('Enter a valid 32-byte 0x-prefixed private key in the local injection window.');
  }
  try {
    return new Wallet(privateKey);
  } catch {
    throw new Error('The private key is invalid. Its value was not displayed or saved.');
  }
}

export async function signAndBroadcastMorph({ signer, provider, transaction, feeLimitWei }) {
  if (BigInt(await provider.send('eth_chainId', [])) !== MORPH_CHAIN_ID) {
    throw new Error('Local signer RPC is not Morph Mainnet.');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(transaction.to || '') ||
      !/^0x(?:[0-9a-fA-F]{2})*$/.test(transaction.data || '') ||
      BigInt(transaction.value || '0') < 0n || BigInt(feeLimitWei) <= 0n) {
    throw new Error('Invalid Morph transaction fields.');
  }

  const [nonce, gasPriceHex, priorityHex] = await Promise.all([
    provider.getTransactionCount(signer.address, 'pending'),
    provider.send('eth_gasPrice', []),
    provider.send('eth_maxPriorityFeePerGas', [])
  ]);
  const maxFeePerGas = BigInt(gasPriceHex);
  const maxPriorityFeePerGas = BigInt(priorityHex);
  const feeLimit = BigInt(feeLimitWei);
  const value = BigInt(transaction.value || '0');
  const estimate = BigInt(await provider.send('eth_estimateGas', [{
    from: signer.address,
    to: transaction.to,
    data: transaction.data,
    value: toQuantity(value),
    maxFeePerGas: toQuantity(maxFeePerGas),
    maxPriorityFeePerGas: toQuantity(maxPriorityFeePerGas),
    feeTokenID: toQuantity(MORPH_FEE_TOKEN_ID),
    feeLimit: toQuantity(feeLimit)
  }]));
  const gasLimit = (estimate * 120n + 99n) / 100n;
  const unsigned = [
    quantity(MORPH_CHAIN_ID),
    quantity(BigInt(nonce)),
    quantity(maxPriorityFeePerGas),
    quantity(maxFeePerGas),
    quantity(gasLimit),
    transaction.to,
    quantity(value),
    transaction.data,
    [],
    quantity(MORPH_FEE_TOKEN_ID),
    quantity(feeLimit)
  ];
  const signingHash = keccak256(concat(['0x7f', encodeRlp(unsigned)]));
  const signature = signer.signingKey.sign(signingHash);
  const signed = [
    ...unsigned,
    quantity(BigInt(signature.yParity)),
    quantity(BigInt(signature.r)),
    quantity(BigInt(signature.s))
  ];
  const rawTransaction = concat(['0x7f', encodeRlp(signed)]);
  const localHash = keccak256(rawTransaction);
  let hash;
  try {
    hash = await provider.send('eth_sendRawTransaction', [rawTransaction]);
  } catch {
    const error = new Error(`Broadcast result is unknown for ${localHash}. Inspect this transaction before retrying.`);
    error.transactionHash = localHash;
    throw error;
  }
  if (typeof hash !== 'string' || hash.toLowerCase() !== localHash.toLowerCase()) {
    const error = new Error(`RPC returned an unexpected broadcast hash. Inspect locally computed transaction ${localHash} before retrying.`);
    error.transactionHash = localHash;
    throw error;
  }
  return { hash, gasLimit: gasLimit.toString(), feeLimitWei: feeLimit.toString() };
}

export async function waitForMorphReceipt(provider, hash, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await provider.send('eth_getTransactionReceipt', [hash]);
    if (receipt) return receipt;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for transaction ${hash}. Inspect it before retrying.`);
}
