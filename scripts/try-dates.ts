/**
 * Scratch harness: what date does each reconciliation tab resolve to, and does
 * the sequence run forward? Not part of the app.
 *
 *   npx tsx scripts/try-dates.ts "<recon.xlsx>"
 */
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { parseReconciliationBuffer, tabInvoiceNumber } from "../src/lib/excel/parseReconciliation";

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx scripts/try-dates.ts <recon.xlsx>");
  process.exit(1);
}
const buf = readFileSync(path);
const wb = XLSX.read(buf, { type: "buffer", bookSheets: true });

const out: { n: number; tab: string; period: string; date: Date | null; note: string }[] = [];
for (const name of wb.SheetNames) {
  const n = tabInvoiceNumber(name);
  if (n === null) continue;
  const p = parseReconciliationBuffer(buf, 12.5, 10, name);
  const dateWarn = p.warnings.find((w) => w.startsWith("Invoice date"));
  out.push({
    n,
    tab: name,
    period: p.meta.periodLabel ?? "--",
    date: p.meta.date,
    note: dateWarn ? (dateWarn.includes("transposed") ? "CORRECTED" : "flagged") : "",
  });
}
out.sort((a, b) => a.n - b.n);

const fmt = (d: Date | null) => (d ? d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" }) : "--");
console.log("%s %s %s %s", "#".padEnd(4), "PERIOD".padEnd(10), "RESOLVED DATE".padEnd(14), "");
console.log("-".repeat(52));
let prev: Date | null = null;
let forward = true;
let dated = 0;
for (const r of out) {
  if (r.date) {
    dated++;
    if (prev && r.date < prev) forward = false;
    prev = r.date;
  }
  console.log("%s %s %s %s", String(r.n).padEnd(4), r.period.padEnd(10), fmt(r.date).padEnd(14), r.note);
}
console.log("-".repeat(52));
console.log(`${out.length} invoice tabs, ${dated} with a usable date`);
console.log(`dates run monotonically forward: ${forward}`);
console.log(`corrected: ${out.filter((r) => r.note === "CORRECTED").length}   flagged: ${out.filter((r) => r.note === "flagged").length}`);
const first = out.find((r) => r.date);
if (first) console.log(`\nearliest dated invoice: #${first.n} — ${fmt(first.date)}`);
