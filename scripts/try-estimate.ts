/**
 * Scratch harness: run parseEstimateBuffer over a real estimate export and
 * report what it produced, aggregated by cost code. Not part of the app.
 *
 *   npx tsx scripts/try-estimate.ts "<path to .xlsx>"
 */
import { readFileSync } from "node:fs";
import { parseEstimateBuffer } from "../src/lib/excel/parseEstimate";

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx scripts/try-estimate.ts <file.xlsx>");
  process.exit(1);
}

const parsed = parseEstimateBuffer(readFileSync(path));
const fmt = (c: number) => `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

console.log(`lines parsed: ${parsed.lines.length}`);
console.log(`warnings:     ${parsed.warnings.length}`);
for (const w of parsed.warnings.slice(0, 8)) console.log(`  ! ${w}`);
if (parsed.warnings.length > 8) console.log(`  … ${parsed.warnings.length - 8} more`);

const byCode = new Map<string, { name: string | null; n: number; cents: number }>();
let total = 0;
let noCode = 0;
for (const l of parsed.lines) {
  total += l.totalCents;
  const key = l.costCode ?? "(none)";
  if (!l.costCode) noCode++;
  const e = byCode.get(key) ?? { name: l.costCodeName, n: 0, cents: 0 };
  e.n++;
  e.cents += l.totalCents;
  if (!e.name && l.costCodeName) e.name = l.costCodeName;
  byCode.set(key, e);
}

console.log(`\ndistinct cost codes: ${byCode.size}   lines with no code: ${noCode}`);
console.log(`BASE total: ${fmt(total)}`);
console.log(`inc 12.5% margin + 10% GST: ${fmt(Math.round(total * 1.125 * 1.1))}\n`);

const rows = [...byCode.entries()].sort((a, b) => b[1].cents - a[1].cents);
for (const [code, e] of rows) {
  console.log(`${code.padEnd(8)} ${(e.name ?? "(no name)").padEnd(36)} ${String(e.n).padStart(3)} lines ${fmt(e.cents).padStart(16)}`);
}
