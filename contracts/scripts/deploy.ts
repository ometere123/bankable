// Deploys StatementRegistry. Run: DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy.ts --network qieMainnet
// The key is read from YOUR shell environment only; it is never written anywhere.
import { ethers, network, artifacts } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No signer: set DEPLOYER_PRIVATE_KEY in your environment (never commit it).");
  const net = await ethers.provider.getNetwork();
  const live = network.name === "qieMainnet";
  if (live && net.chainId !== 1990n) throw new Error(`Refusing: expected chain 1990, got ${net.chainId}`);
  const bal = await ethers.provider.getBalance(signer.address);
  console.log(`network ${network.name} chain ${net.chainId}\ndeployer ${signer.address}\nbalance ${ethers.formatEther(bal)} QIE`);
  if (bal === 0n) throw new Error("Deployer has no QIE for gas (estimated cost is well under 0.001 QIE; see docs/gates/g3-evm-probe.json).");

  const art = await artifacts.readArtifact("StatementRegistry");
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, signer); // ethers v6 deployment calls
  const c = await factory.deploy();
  const tx = c.deploymentTransaction()!;
  console.log("deploy tx", tx.hash);
  const rc = await tx.wait();
  if (!rc || rc.status !== 1) throw new Error("deployment transaction failed");
  const address = await c.getAddress();
  const onchain = await ethers.provider.getCode(address);
  if (onchain.toLowerCase() !== art.deployedBytecode.toLowerCase()) throw new Error("on-chain runtime bytecode differs from the local build");
  // read-back: unknown id reads as zero owner
  const rec = await (c as any).getRecord(ethers.ZeroHash.replace(/0$/, "1"));
  if (rec.owner !== ethers.ZeroAddress) throw new Error("unexpected record state on a fresh registry");

  const buildInfo = JSON.parse(fs.readFileSync(path.join("artifacts/build-info", fs.readdirSync("artifacts/build-info").find((f) => f.endsWith(".json"))!), "utf8"));
  const record = {
    network: network.name, chainId: Number(net.chainId), address, deployTx: tx.hash, deployBlock: rc.blockNumber, deployer: signer.address,
    compiler: { version: buildInfo.solcLongVersion, evmVersion: "paris", optimizer: { enabled: true, runs: 200 } },
    runtimeBytecodeKeccak256: ethers.keccak256(onchain), runtimeBytes: (onchain.length - 2) / 2,
    explorer: `https://mainnet.qie.digital/address/${address}`, deployedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(record, null, 2));
  if (live) { fs.mkdirSync("deployments", { recursive: true }); fs.writeFileSync("deployments/mainnet.json", JSON.stringify(record, null, 2) + "\n"); console.log("wrote deployments/mainnet.json; set NEXT_PUBLIC_REGISTRY_ADDRESS and STATEMENT_REGISTRY_ADDRESS to", address); }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
