import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-network-helpers";

// Spec 4.2: Solidity 0.8.20 with evmVersion "paris" (0.8.20 defaults to Shanghai/PUSH0, which some chains lack).
const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];
const config: HardhatUserConfig = {
  solidity: { version: "0.8.20", settings: { evmVersion: "paris", optimizer: { enabled: true, runs: 200 }, metadata: { bytecodeHash: "ipfs" } } },
  networks: {
    hardhat: { hardfork: "merge", chainId: Number(process.env.HARDHAT_CHAIN_ID ?? 31337), blockGasLimit: 30_000_000, allowUnlimitedContractSize: false, ...(process.env.HARDHAT_INITIAL_DATE ? { initialDate: process.env.HARDHAT_INITIAL_DATE } : {}) },
    qieMainnet: { url: process.env.QIE_RPC_A ?? "https://rpc1mainnet.qie.digital", chainId: 1990, accounts },
    qieTestnet: { url: "https://rpc1testnet.qie.digital", chainId: 1983, accounts },
  },
  paths: { sources: "contracts", tests: "test" },
  mocha: { timeout: 120000 },
};
export default config;
