// Browser entry for the G2 cross-engine determinism gate. Bundled by g2-render.mts. Uses the real renderer and the shared fixtures.
import { renderStatementPdf } from "../../packages/core/src/render/pdf";
import { fixtureByName } from "./g2-fixtures";
declare global { interface Window { renderFixture: (name: string, origin: string) => Promise<string> } }
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
window.renderFixture = async (name, origin) => b64(await renderStatementPdf(fixtureByName(name), { origin }));
