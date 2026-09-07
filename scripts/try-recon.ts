/**
 * Scratch harness: run parseReconciliationBuffer over every tab of a real
 * reconciliation workbook and report what came out. Not part of the app.
 *
 *   npx tsx scripts/try-recon.ts "<path to .xlsx>" [tabName]
 */
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { parseReconciliationBuffer } from "../src/lib/excel/parseReconciliation";

const path = process.argv[2];
const only = process.argv[3];
if (!path) {
  console.error("usage: npx tsx scripts/try-recon.ts <file.xlsx> [tabName]");
  process.exit(1);
}
const buf = readFileSync(path);
const fmt = (c: number) => (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// parseReconciliationBuffer picks ONE sheet, so to exercise each tab we hand it
// a single-sheet workbook built from that tab.
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const tabs = only ? [only] : wb.SheetNames;

console.log(
  ["TAB".padEnd(24), "INV#".padStart(5), "PERIOD".padEnd(10), "CODES".padStart(6), "SUPPL".padStart(6), "COSTS".padStart(14), "LABOUR".padStart(12), "TOTAL".padStart(14)].join(" "),
);
console.log("-".repeat(98));

let warned = 0;
for (const name of tabs) {
  const one = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(one, wb.Sheets[name], "Invoice x");
  // Preserve the original tab name so the meta regex sees the real thing.
  one.SheetNames[0] = name;
  one.Sheets[name] = one.Sheets["Invoice x"];
  delete one.Sheets["Invoice x"];
  const p = parseReconciliationBuffer(XLSX.write(one, { type: "buffer", bookType: "xlsx" }) as Buffer);
  console.log(
    [
      name.slice(0, 24).padEnd(24),
      String(p.meta.invoiceNumber ?? "--").padStart(5),
      (p.meta.periodLabel ?? "--").slice(0, 10).padEnd(10),
      String(p.budgetOverview.length).padStart(6),
      String(p.supplierLines.length).padStart(6),
      fmt(p.costsCents).padStart(14),
      fmt(p.labourCents).padStart(12),
      fmt(p.totalCents).padStart(14),
    ].join(" "),
  );
  for (const w of p.warnings) {
    warned++;
    console.log(`      ! ${w.slice(0, 88)}`);
  }
}
console.log("-".repeat(98));
console.log(`tabs: ${tabs.length}   tabs with warnings: ${warned}`);
