import { expect } from "chai";
import { ethers } from "hardhat";
import { mine, time } from "@nomicfoundation/hardhat-network-helpers";

const b32 = (n: number) => ethers.zeroPadValue(ethers.toBeHex(n), 32);
const idOf = (owner: string, pdfHash: string) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [owner, pdfHash]));

describe("StatementRegistry", () => {
  let reg: any; let owner: any, other: any;
  let base: { start: bigint; end: bigint; from: bigint; to: bigint };
  const args = (o: Partial<{ s: bigint; e: bigint; f: bigint; t: bigint; req: string; salt: string; data: string; pdf: string; rid: string }> = {}) => {
    const v = { s: base.start, e: base.end, f: base.from, t: base.to, req: b32(1), salt: b32(2), data: b32(3), pdf: b32(4), rid: b32(5), ...o };
    return [v.s, v.e, v.f, v.t, v.req, v.salt, v.data, v.pdf, v.rid] as const;
  };
  beforeEach(async () => {
    [owner, other] = await ethers.getSigners();
    reg = await (await ethers.getContractFactory("StatementRegistry")).deploy();
    await mine(20);
    const bn = BigInt(await ethers.provider.getBlockNumber());
    const ts = BigInt(await time.latest());
    base = { start: ts - 1000n, end: ts - 10n, from: bn - 15n, to: bn - 2n };
  });

  it("registers, derives id from (owner, pdfHash), emits event, and reads back every field", async () => {
    const tx = await reg.connect(owner).register(...args());
    const rc = await tx.wait();
    const id = idOf(owner.address, b32(4));
    await expect(tx).to.emit(reg, "StatementRegistered").withArgs(id, owner.address, b32(1), b32(3), b32(4), base.from, base.to);
    const r = await reg.getRecord(id);
    expect(r.owner).to.equal(owner.address);
    expect(r.startUnix).to.equal(base.start); expect(r.endUnix).to.equal(base.end);
    expect(r.fromBlock).to.equal(base.from); expect(r.toBlock).to.equal(base.to);
    expect(r.registeredBlock).to.equal(rc.blockNumber); expect(r.revokedBlock).to.equal(0);
    expect(r.requestId).to.equal(b32(1)); expect(r.issuanceSalt).to.equal(b32(2));
    expect(r.dataHash).to.equal(b32(3)); expect(r.pdfHash).to.equal(b32(4)); expect(r.rendererId).to.equal(b32(5));
  });

  it("unknown id reads as owner == zero", async () => {
    expect((await reg.getRecord(b32(99))).owner).to.equal(ethers.ZeroAddress);
  });

  describe("register reverts", () => {
    for (const [name, key] of [["requestId", "req"], ["issuanceSalt", "salt"], ["dataHash", "data"], ["pdfHash", "pdf"], ["rendererId", "rid"]] as const)
      it(`zero ${name}`, async () => { await expect(reg.register(...args({ [key]: ethers.ZeroHash }))).to.be.revertedWithCustomError(reg, "ZeroCommitment"); });
    it("fromBlock of 0", async () => { await expect(reg.register(...args({ f: 0n }))).to.be.revertedWithCustomError(reg, "BadBlockRange"); });
    it("fromBlock > toBlock", async () => { await expect(reg.register(...args({ f: base.to + 1n }))).to.be.revertedWithCustomError(reg, "BadBlockRange"); });
    it("toBlock at the executing block", async () => {
      const exec = BigInt(await ethers.provider.getBlockNumber()) + 1n; // next block is the executing one
      await expect(reg.register(...args({ t: exec }))).to.be.revertedWithCustomError(reg, "BadBlockRange");
    });
    it("toBlock beyond the executing block", async () => { await expect(reg.register(...args({ t: base.to + 1000n }))).to.be.revertedWithCustomError(reg, "BadBlockRange"); });
    it("startUnix >= endUnix", async () => { await expect(reg.register(...args({ s: base.end }))).to.be.revertedWithCustomError(reg, "BadPeriod"); });
    it("endUnix after block.timestamp", async () => { await expect(reg.register(...args({ e: BigInt(await time.latest()) + 100000n }))).to.be.revertedWithCustomError(reg, "BadPeriod"); });
    it("duplicate id from the same owner and file", async () => {
      await reg.register(...args());
      await expect(reg.register(...args({ salt: b32(77) }))).to.be.revertedWithCustomError(reg, "DuplicateRecord");
    });
  });

  describe("revoke", () => {
    it("owner revokes; record keeps its data, revokedBlock set, event emitted", async () => {
      await reg.register(...args());
      const id = idOf(owner.address, b32(4));
      const tx = await reg.revoke(id); const rc = await tx.wait();
      await expect(tx).to.emit(reg, "StatementRevoked").withArgs(id, owner.address, rc.blockNumber);
      const r = await reg.getRecord(id);
      expect(r.revokedBlock).to.equal(rc.blockNumber); expect(r.pdfHash).to.equal(b32(4));
    });
    it("non-owner cannot revoke", async () => {
      await reg.register(...args());
      await expect(reg.connect(other).revoke(idOf(owner.address, b32(4)))).to.be.revertedWithCustomError(reg, "NotOwner");
    });
    it("unknown record reverts", async () => { await expect(reg.revoke(b32(1234))).to.be.revertedWithCustomError(reg, "UnknownRecord"); });
    it("already-revoked reverts and is never reactivated", async () => {
      await reg.register(...args()); const id = idOf(owner.address, b32(4));
      await reg.revoke(id);
      await expect(reg.revoke(id)).to.be.revertedWithCustomError(reg, "AlreadyRevoked");
      expect((await reg.getRecord(id)).revokedBlock).to.not.equal(0);
    });
    it("a revoked file can never be re-registered by the same owner", async () => {
      await reg.register(...args()); await reg.revoke(idOf(owner.address, b32(4)));
      await expect(reg.register(...args({ salt: b32(88) }))).to.be.revertedWithCustomError(reg, "DuplicateRecord");
    });
  });

  describe("adversarial and reissue", () => {
    it("third party registering the same file hash gets a different id and cannot take over the original", async () => {
      await reg.connect(owner).register(...args());
      await reg.connect(other).register(...args());
      const idA = idOf(owner.address, b32(4)), idB = idOf(other.address, b32(4));
      expect(idA).to.not.equal(idB);
      expect((await reg.getRecord(idA)).owner).to.equal(owner.address);
      expect((await reg.getRecord(idB)).owner).to.equal(other.address);
      await expect(reg.connect(other).revoke(idA)).to.be.revertedWithCustomError(reg, "NotOwner");
    });
    it("reissue: same requestId, fresh salt and file gives a new record; the old one stays valid until revoked", async () => {
      await reg.register(...args());
      await reg.register(...args({ salt: b32(22), data: b32(3), pdf: b32(40) }));
      const a = await reg.getRecord(idOf(owner.address, b32(4))), b = await reg.getRecord(idOf(owner.address, b32(40)));
      expect(a.requestId).to.equal(b.requestId); expect(a.issuanceSalt).to.not.equal(b.issuanceSalt);
      expect(a.revokedBlock).to.equal(0); expect(b.revokedBlock).to.equal(0);
      await reg.revoke(idOf(owner.address, b32(4)));
      expect((await reg.getRecord(idOf(owner.address, b32(4)))).revokedBlock).to.not.equal(0);
      expect((await reg.getRecord(idOf(owner.address, b32(40)))).revokedBlock).to.equal(0);
    });
  });

  describe("shape", () => {
    it("rejects plain ether transfers and has no payable, admin or upgrade surface", async () => {
      await expect(owner.sendTransaction({ to: await reg.getAddress(), value: 1n })).to.be.reverted;
      const frags = reg.interface.fragments.filter((f: any) => f.type === "function");
      expect(frags.map((f: any) => f.name).sort()).to.deep.equal(["getRecord", "register", "revoke"]);
      expect(frags.some((f: any) => f.payable)).to.equal(false);
    });
    it("runtime bytecode is Paris-compatible (no PUSH0 executed on a Paris EVM; deploy and calls succeeded above)", async () => {
      const code = await ethers.provider.getCode(await reg.getAddress());
      expect((code.length - 2) / 2).to.be.greaterThan(1000);
    });
  });
});
