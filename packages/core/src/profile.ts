import { keccak256, toUtf8Bytes } from "ethers";
import type { StatementData } from "./canonical";
import { renderStatementPdf } from "./render/pdf";

/** Section 5.2. rendererId = keccak256(manifest bytes). The registry does not whitelist profiles; the verifier decides. */
export interface ProfileManifest {
  profile: string;
  origin: string;
  template: { files: Record<string, string> }; // path -> sha256 of renderer source
  dependencies: Record<string, string>; // name@version -> lockfile integrity
  fonts: { family: string[]; embedded: boolean };
  qr: { library: string; errorCorrection: string; mode: string };
}
export interface Profile { rendererId: string; manifest: ProfileManifest; manifestText: string; render(d: StatementData): Promise<Uint8Array> }

export function rendererIdOf(manifestText: string): string { return keccak256(toUtf8Bytes(manifestText)); }

/** Build the supported-profile table from committed manifest texts. A manifest text is only trusted by its own hash. */
export function loadProfiles(manifestTexts: string[]): Map<string, Profile> {
  const m = new Map<string, Profile>();
  for (const text of manifestTexts) {
    const manifest = JSON.parse(text) as ProfileManifest;
    const rendererId = rendererIdOf(text);
    m.set(rendererId, { rendererId, manifest, manifestText: text, render: (d) => renderStatementPdf(d, { origin: manifest.origin }) });
  }
  return m;
}
