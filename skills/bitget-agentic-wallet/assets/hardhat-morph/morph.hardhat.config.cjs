const path = require('node:path');
require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');

module.exports = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: { enabled: true, runs: 300 },
      viaIR: true
    }
  },
  networks: {
    morphMainnet: {
      url: process.env.MORPH_RPC_URL || 'https://rpc-bgw.morph.network',
      chainId: 2818
    },
    morphHoodi: {
      url: process.env.MORPH_HOODI_RPC_URL || 'https://rpc-hoodi-bgw.morph.network',
      chainId: 2910
    }
  },
  paths: {
    sources: path.resolve(__dirname, 'morph-hardhat-contracts'),
    tests: path.resolve(__dirname, 'morph-hardhat-test'),
    cache: path.resolve(__dirname, 'cache/morph-hardhat'),
    artifacts: path.resolve(__dirname, 'artifacts/morph-hardhat')
  },
  mocha: { timeout: 60000 }
};
