export const NETWORKS = Object.freeze({
  morph: Object.freeze({
    key: 'morph',
    name: 'Morph Mainnet',
    chainId: 2818,
    rpcUrl: 'https://rpc-bgw.morph.network',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://explorer.morph.network/'
  }),
  bsc: Object.freeze({
    key: 'bsc',
    name: 'BNB Smart Chain',
    chainId: 56,
    rpcUrl: 'https://bsc-dataseed.binance.org',
    nativeSymbol: 'BNB',
    explorerUrl: 'https://bscscan.com/'
  }),
  arbitrum: Object.freeze({
    key: 'arbitrum',
    name: 'Arbitrum One',
    chainId: 42161,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://arbiscan.io/'
  }),
  ethereum: Object.freeze({
    key: 'ethereum',
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: 'https://cloudflare-eth.com',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://etherscan.io/'
  }),
  polygon: Object.freeze({
    key: 'polygon',
    name: 'Polygon PoS',
    chainId: 137,
    rpcUrl: 'https://polygon-rpc.com',
    nativeSymbol: 'POL',
    explorerUrl: 'https://polygonscan.com/'
  }),
  base: Object.freeze({
    key: 'base',
    name: 'Base',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://basescan.org/'
  })
});

export const NETWORK_KEYS = Object.freeze(Object.keys(NETWORKS));
export const NETWORK_CHAIN_IDS = Object.freeze(NETWORK_KEYS.map(key => NETWORKS[key].chainId));
export const NETWORK_RPC_MAP = Object.freeze(
  Object.fromEntries(NETWORK_KEYS.map(key => [NETWORKS[key].chainId, NETWORKS[key].rpcUrl]))
);

const NETWORK_BY_CHAIN_ID = new Map(NETWORK_KEYS.map(key => [NETWORKS[key].chainId, NETWORKS[key]]));

export function getNetwork(key) {
  return NETWORKS[key] || null;
}

export function networkForChainId(chainId) {
  return NETWORK_BY_CHAIN_ID.get(Number(chainId)) || null;
}

export function supportedNetworkSummary() {
  return NETWORK_KEYS.map(key => {
    const network = NETWORKS[key];
    return { key: network.key, name: network.name, chainId: network.chainId, nativeSymbol: network.nativeSymbol };
  });
}
