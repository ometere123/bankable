import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { StatementData } from "../canonical";
import { dataHashOf } from "../canonical";
import { totalsOf } from "../ledger";
import { amountStr, chunkString, utcStamp } from "./format";
import { qrMatrix } from "./qr";

export const FOOTER_TEXT = "Evidence derived from public chain data. Not a certified bank statement.";
export interface RenderProfile { origin: string }

const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 40;
const INK = rgb(0.09, 0.09, 0.1), GREY = rgb(0.4, 0.4, 0.42), RULE = rgb(0.75, 0.75, 0.72), ACCENT = rgb(0.1, 0.25, 0.5);
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

export function locatorUrl(origin: string, d: StatementData): string {
  const p = new URLSearchParams({ v: "1", chain: d.chainId.toString(), registry: d.registry, owner: d.owner, data: dataHashOf(d) });
  return `${origin.replace(/\/$/, "")}/verify#${p.toString()}`;
}
export function metadataLocator(origin: string, d: StatementData): string {
  // strict single-line locator, also embedded in /Keywords for the Tier 2 metadata reader
  return `bankable:v1;chain=${d.chainId};registry=${d.registry};owner=${d.owner};profile=${d.rendererId};data=${dataHashOf(d)}`;
}

class Cursor {
  page!: PDFPage; y = 0; pageNo = 0; pages: PDFPage[] = [];
  constructor(private doc: PDFDocument, private onNew: (c: Cursor) => void) {}
  newPage() { this.page = this.doc.addPage([PAGE_W, PAGE_H]); this.pages.push(this.page); this.pageNo++; this.y = PAGE_H - MARGIN; this.onNew(this); }
  ensure(h: number) { if (this.y - h < MARGIN + 30) this.newPage(); }
}

export async function renderStatementPdf(d: StatementData, profile: RenderProfile): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  // G2 finding: pdf-lib derives font resource names from a seeded RNG built on Math.sin, whose last-bit result
  // differs between engines/V8 versions (Chromium 158 vs Node 22 diverged on a 600-entry fixture). Replace it with
  // a plain counter so no output byte depends on floating-point transcendental functions or Math.random.
  let nameCounter = 0;
  (doc.context as unknown as { addRandomSuffix: (prefix: string, len?: number) => string }).addRandomSuffix =
    (prefix: string) => `${prefix}-${++nameCounter}`;
  doc.setTitle("Bankable QUSDC statement");
  doc.setAuthor("Bankable");
  doc.setSubject("QUSDC history on QIE mainnet for a fixed UTC period");
  doc.setKeywords([metadataLocator(profile.origin, d)]);
  doc.setCreator("Bankable renderer");
  doc.setProducer("Bankable renderer (pdf-lib)");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const text = (c: Cursor, s: string, o: { x?: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    c.page.drawText(s, { x: o.x ?? MARGIN, y: c.y, size: o.size ?? 9, font: o.font ?? sans, color: o.color ?? INK });
  };
  const rule = (c: Cursor) => c.page.drawLine({ start: { x: MARGIN, y: c.y }, end: { x: PAGE_W - MARGIN, y: c.y }, thickness: 0.5, color: RULE });
  const wrap = (s: string, font: PDFFont, size: number, width: number): string[] => {
    const lines: string[] = []; let cur = "";
    for (const w of s.split(" ")) {
      const t = cur ? cur + " " + w : w;
      if (font.widthOfTextAtSize(t, size) <= width) cur = t; else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur); return lines;
  };

  const totals = totalsOf(d.entries);
  const dec = d.decimals;
  const monoW = (size: number) => mono.widthOfTextAtSize("0", size);
  const fullW = PAGE_W - 2 * MARGIN;

  const c = new Cursor(doc, (cur) => {
    // running header on every page
    cur.page.drawText("BANKABLE  QUSDC statement", { x: MARGIN, y: cur.y, size: 9, font: bold, color: ACCENT });
    cur.page.drawText(`${d.owner.slice(0, 10)}...${d.owner.slice(-6)}  ${utcStamp(d.startUnix)} to ${utcStamp(d.endUnix)}`, { x: PAGE_W - MARGIN - mono.widthOfTextAtSize(`${d.owner.slice(0, 10)}...${d.owner.slice(-6)}  ${utcStamp(d.startUnix)} to ${utcStamp(d.endUnix)}`, 6.5), y: cur.y, size: 6.5, font: mono, color: GREY });
    cur.y -= 8; rule(cur); cur.y -= 18;
  });
  c.newPage();

  // ---- page one: scope ----
  text(c, "QUSDC statement", { size: 20, font: bold }); c.y -= 24;
  text(c, "Public-chain evidence for one address and one completed UTC period", { size: 9, color: GREY }); c.y -= 22;

  const kv = (k: string, v: string, mode: "sans" | "mono" = "mono") => {
    c.ensure(14);
    text(c, k, { size: 8, color: GREY });
    const size = mode === "mono" ? 8 : 9; const font = mode === "mono" ? mono : sans;
    const maxChars = Math.floor((fullW - 120) / monoW(size));
    const lines = mode === "mono" ? chunkString(v, maxChars) : [v];
    for (const l of lines) { text(c, l, { x: MARGIN + 120, size, font }); c.y -= 11; }
    c.y -= 1;
  };
  kv("Wallet", d.owner);
  kv("Chain", `QIE mainnet (chain id ${d.chainId})`, "sans");
  kv("Token contract", d.token);
  kv("Token decimals", String(dec), "sans");
  kv("Period start", utcStamp(d.startUnix), "sans");
  kv("Period end (exclusive)", utcStamp(d.endUnix), "sans");
  kv("Block range", `${d.fromBlock} to ${d.toBlock} (inclusive)`, "sans");
  kv("From block hash", d.fromBlockHash);
  kv("To block hash", d.toBlockHash);
  kv("Registry", d.registry);
  kv("Request id", d.requestId);
  kv("Issuance salt", d.issuanceSalt);
  kv("Renderer profile", d.rendererId);
  c.y -= 4; rule(c); c.y -= 16;

  text(c, "Balances (QUSDC)", { size: 11, font: bold }); c.y -= 16;
  const bal = (k: string, v: string) => { text(c, k, { size: 9 }); text(c, v, { x: MARGIN + 170, size: 10, font: mono }); c.y -= 14; };
  bal("Opening balance", amountStr(d.opening, dec));
  bal(`Incoming (${totals.countIn} transfers)`, amountStr(totals.incoming, dec));
  bal(`Outgoing (${totals.countOut} transfers)`, amountStr(totals.outgoing, dec));
  bal(`Self-transfers (${totals.countSelf}, excluded above)`, amountStr(totals.self, dec));
  bal("Closing balance", amountStr(d.closing, dec));
  c.y -= 4; rule(c); c.y -= 16;

  // ---- non-claims box ----
  const claims = [
    "What this document does not prove.",
    "It is not a bank statement and not a certified record. It does not prove cryptographic completeness of the RPC history, earlier control of the address, genuine income, source of funds, the owner's total finances, recipient identity, or institutional acceptance. QUSDC is a bridged token, not Circle-issued native USDC. Amounts are token units, never a fiat valuation. A transfer from another wallet of the same owner is a valid entry, and the statement makes no income claim.",
    "Verification means: the file's bytes equal the canonical rendering of on-chain QUSDC data for this wallet and period, and this wallet registered that file's hash on QIE mainnet. Check status at the verifier; a later revocation withdraws the attestation but does not make past transfers untrue.",
  ];
  const boxLines: { s: string; b: boolean }[] = [];
  claims.forEach((t, i) => wrap(t, i === 0 ? bold : sans, 8, fullW - 16).forEach((l) => boxLines.push({ s: l, b: i === 0 })));
  const boxH = boxLines.length * 10.5 + 14;
  c.ensure(boxH + 4);
  c.page.drawRectangle({ x: MARGIN, y: c.y - boxH + 4, width: fullW, height: boxH, borderColor: INK, borderWidth: 0.75 });
  let by = c.y - 8;
  for (const l of boxLines) { c.page.drawText(l.s, { x: MARGIN + 8, y: by, size: 8, font: l.b ? bold : sans, color: INK }); by -= 10.5; }
  c.y -= boxH + 10;

  // ---- QR: vector rectangles, locator only ----
  const url = locatorUrl(profile.origin, d);
  const m = qrMatrix(url); const cell = 2.2; const qrSize = m.length * cell;
  c.ensure(qrSize + 30);
  const top = c.y;
  text(c, "Locator (not proof of registration or file integrity)", { size: 8, color: GREY });
  const qy = top - 12;
  for (let r = 0; r < m.length; r++) for (let q = 0; q < m.length; q++)
    if (m[r]![q]) c.page.drawRectangle({ x: MARGIN + q * cell, y: qy - (r + 1) * cell, width: cell, height: cell, color: INK });
  const ux = MARGIN + qrSize + 14; let uy = qy - 8;
  const urlMax = Math.floor((PAGE_W - MARGIN - ux) / monoW(6.5));
  for (const l of chunkString(url, urlMax)) { c.page.drawText(l, { x: ux, y: uy, size: 6.5, font: mono, color: GREY }); uy -= 8; }
  c.y = qy - qrSize - 14;

  // ---- entry table (paginated) ----
  c.newPage();
  text(c, `Transactions (${d.entries.length})`, { size: 11, font: bold }); c.y -= 8;
  if (d.entries.length === 0) { c.y -= 10; text(c, "No QUSDC transfers involved this wallet in the period.", { size: 9 }); c.y -= 14; }
  const colX = { dir: MARGIN, time: MARGIN + 18, block: MARGIN + 130, amt: MARGIN + 200 };
  d.entries.forEach((e, i) => {
    const rowH = 66;
    c.ensure(rowH);
    c.y -= 4; rule(c); c.y -= 12;
    const label = e.direction === "C" ? "IN" : e.direction === "D" ? "OUT" : "SELF";
    c.page.drawText(`${i + 1}. ${label}`, { x: colX.dir, y: c.y, size: 8, font: bold, color: ACCENT });
    c.page.drawText(utcStamp(e.timestamp), { x: colX.time + 20, y: c.y, size: 8, font: mono });
    c.page.drawText(`block ${e.block}  log ${e.logIndex}`, { x: colX.block + 40, y: c.y, size: 8, font: mono });
    const a = amountStr(e.amount, dec);
    c.page.drawText(a, { x: PAGE_W - MARGIN - mono.widthOfTextAtSize(a, 9), y: c.y, size: 9, font: mono });
    c.y -= 11;
    const line = (k: string, v: string) => {
      const w = Math.floor((fullW - 64) / monoW(6.8));
      chunkString(v, w).forEach((ln, j) => { if (j === 0) c.page.drawText(k, { x: MARGIN, y: c.y, size: 6.8, font: sans, color: GREY }); c.page.drawText(ln, { x: MARGIN + 64, y: c.y, size: 6.8, font: mono }); c.y -= 8.2; });
    };
    line("tx", e.txHash); line("from", e.from); line("to", e.to);
  });

  // ---- footers with total page count (after pagination is fixed) ----
  const n = c.pages.length;
  c.pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 18 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 18 }, thickness: 0.5, color: RULE });
    p.drawText(FOOTER_TEXT, { x: MARGIN, y: MARGIN + 6, size: 7.5, font: sans, color: GREY });
    const pg = `Page ${i + 1} of ${n}`;
    p.drawText(pg, { x: PAGE_W - MARGIN - sans.widthOfTextAtSize(pg, 7.5), y: MARGIN + 6, size: 7.5, font: sans, color: GREY });
  });

  // useObjectStreams:false -> classic xref, fewer moving parts; addDefaultPage not used.
  return doc.save({ useObjectStreams: false });
}
