import qrcode from "qrcode-generator";
/** Returns the module matrix (true = dark). Deterministic: fixed error correction, version chosen by payload size, byte mode. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const m: boolean[][] = [];
  for (let r = 0; r < n; r++) { const row: boolean[] = []; for (let c = 0; c < n; c++) row.push(qr.isDark(r, c)); m.push(row); }
  return m;
}
