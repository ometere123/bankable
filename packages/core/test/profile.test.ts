import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { keccak256, toUtf8Bytes } from "ethers";
import { loadProfiles, rendererIdOf, type ProfileManifest } from "../src/profile";
import { PROFILE_MANIFESTS } from "../src/profiles.generated";

const core = path.resolve(__dirname, ".."); const repo = path.resolve(core, "../..");
const sha = (b: Buffer) => "0x" + createHash("sha256").update(b).digest("hex");

describe("renderer profile manifest commits to what actually renders (spec 5.2)", () => {
  const texts = PROFILE_MANIFESTS;
  it("the generated module equals the committed profiles/*.json byte for byte", () => {
    const onDisk = fs.readdirSync(path.join(core, "profiles")).sort().map((f) => fs.readFileSync(path.join(core, "profiles", f), "utf8"));
    expect(texts).toEqual(onDisk);
  });
  it("rendererId is keccak256 of the manifest bytes and is unique per profile", () => {
    const ids = texts.map(rendererIdOf); expect(new Set(ids).size).toBe(ids.length);
    for (const t of texts) expect(rendererIdOf(t)).toBe(keccak256(toUtf8Bytes(t)));
    expect([...loadProfiles(texts).keys()]).toEqual(texts.map(rendererIdOf));
  });
  // The newest profile must describe the code in this checkout. Older profiles would be kept with their own pinned sources.
  it("the newest profile's source hashes equal the current renderer sources (change the renderer => regenerate the profile)", () => {
    const m = JSON.parse(texts.at(-1)!) as ProfileManifest;
    for (const [f, h] of Object.entries(m.template.files)) expect(sha(fs.readFileSync(path.join(core, f))), `${f} changed without regenerating the profile (node scripts/make-profile.mjs)`).toBe(h);
  });
  it("the newest profile's dependency integrity equals pnpm-lock.yaml", () => {
    const m = JSON.parse(texts.at(-1)!) as ProfileManifest; const lock = fs.readFileSync(path.join(repo, "pnpm-lock.yaml"), "utf8");
    for (const [nameVer, integrity] of Object.entries(m.dependencies)) {
      const esc = nameVer.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      expect(new RegExp(`'?${esc}'?:\\n    resolution: \\{integrity: ${integrity.replace(/[+/=]/g, "\\$&")}`).test(lock), nameVer).toBe(true);
    }
  });
  it("fonts are the standard unembedded set and the QR parameters are fixed", () => {
    const m = JSON.parse(texts.at(-1)!) as ProfileManifest;
    expect(m.fonts).toEqual({ family: ["Helvetica", "Helvetica-Bold", "Courier"], embedded: false }); expect(m.qr).toEqual({ library: "qrcode-generator", errorCorrection: "M", mode: "Byte" });
  });
  it("origin is part of the commitment: a different origin yields a different rendererId", () => {
    const m = JSON.parse(texts.at(-1)!) as ProfileManifest;
    expect(rendererIdOf(JSON.stringify({ ...m, origin: "https://other.example" }, null, 2) + "\n")).not.toBe(rendererIdOf(texts.at(-1)!));
  });
});
