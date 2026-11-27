// WCAG AA contrast gate: reads the real colour tokens from globals.css (light and dark) and checks every text/background pair the UI uses.
import fs from "node:fs";
import path from "node:path";
const css = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../app/globals.css"), "utf8");
const root = /:root\s*\{([^}]*)\}/.exec(css)![1]!;
const dark = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)![1]!;
const parse = (b: string) => Object.fromEntries([...b.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1]!, m[2]!]));
const L = parse(root); const D = { ...L, ...parse(dark) };
const lum = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
// [foreground token, background token, minimum]. Large text (>=24px, or 19px bold) needs 3; everything else 4.5.
const PAIRS: [string, string, number][] = [
  ["ink", "paper", 4.5], ["ink", "paper-elevated", 4.5], ["muted", "paper", 4.5], ["muted", "paper-elevated", 4.5],
  ["ink-blue", "paper", 4.5], ["ink-blue", "paper-elevated", 4.5], ["brass-text", "paper", 4.5], ["brass-text", "paper-elevated", 4.5],
  ["ok", "paper", 4.5], ["ok", "paper-elevated", 4.5], ["bad", "paper", 4.5], ["bad", "paper-elevated", 4.5], ["warn", "paper", 4.5], ["warn", "paper-elevated", 4.5],
  ["paper", "ink-blue", 4.5] /* primary button label */,
];
let bad = 0;
for (const [name, T] of [["light", L], ["dark", D]] as const) for (const [f, b, min] of PAIRS) {
  const r = ratio(T[f]!, T[b]!); const ok = r >= min; if (!ok) bad++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(5)} ${f.padEnd(11)} on ${b.padEnd(15)} ${r.toFixed(2)} (min ${min})`);
}
console.log(bad ? `\n${bad} pair(s) below WCAG AA` : "\nall pairs meet WCAG AA");
process.exit(bad ? 1 : 0);
