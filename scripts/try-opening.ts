/**
 * Scratch harness: preview the opening position a reconciliation workbook
 * would carry into a project, matched against a real estimate's cost codes.
 * Not part of the app.
 *
 *   npx tsx scripts/try-opening.ts "<recon.xlsx>" "<estimate.xlsx>" [tabName]
 */
import { readFileSync } from "node:fs";
import { listReconTabs, parseReconciliationBuffer } from "../src/lib/excel/parseReconciliation";
import { parseEstimateBuffer } from "../src/lib/excel/parseEstimate";
import { matchCostCodeId } from "../src/lib/claims";

const [reconPath, estPath, tab] = process.argv.slice(2);
if (!reconPath || !estPath) {
  console.error("usage: npx tsx scripts/try-opening.ts <recon.xlsx> <estimate.xlsx> [tabName]");
  process.exit(1);
}
const fmt = (c: number) =>
  `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Cost codes as the estimate import would create them.
const est = parseEstimateBuffer(readFileSync(estPath));
const codes = new Map<string, { id: string; name: string }>();
for (const l of est.lines) {
  if (l.costCode && !codes.has(l.costCode)) {
    codes.set(l.costCode, { id: l.costCode, name: l.costCodeName ?? l.costCode });
  }
}
const refs = [...codes.values()].sort((a, b) => a.id.localeCompare(b.id));

const buf = readFileSync(reconPath);
console.log(`tabs in workbook: ${listReconTabs(buf).length}`);
const p = parseReconciliationBuffer(buf, 12.5, 10, tab);
console.log(`tab read: "${p.sheetName}"  (invoice #${p.meta.invoiceNumber ?? "?"}, ${p.meta.periodLabel ?? "no period"})`);
for (const w of p.warnings) console.log(`\n  ! ${w}\n`);

console.log(`\n${"RECON LINE".padEnd(38)} ${"COST CODE".padEnd(30)} ${"TO DATE".padStart(15)}`);
console.log("-".repeat(86));
let matched = 0;
let matchedCents = 0;
let unmatchedCents = 0;
const misses: string[] = [];
for (const b of p.budgetOverview) {
  const id = matchCostCodeId(b.name, refs);
  const label = id ? `${id} ${codes.get(id)!.name}` : "*** UNALLOCATED ***";
  if (id) {
    matched++;
    matchedCents += b.toDateCents;
  } else {
    unmatchedCents += b.toDateCents;
    if (b.toDateCents !== 0) misses.push(`${b.name} (${fmt(b.toDateCents)})`);
  }
  console.log(`${b.name.slice(0, 38).padEnd(38)} ${label.slice(0, 30).padEnd(30)} ${fmt(b.toDateCents).padStart(15)}`);
}
console.log("-".repeat(86));
console.log(`matched ${matched}/${p.budgetOverview.length} lines`);
console.log(`  to cost codes   ${fmt(matchedCents).padStart(16)}`);
console.log(`  unallocated     ${fmt(unmatchedCents).padStart(16)}`);
console.log(`  rows total      ${fmt(p.toDateCents).padStart(16)}`);
console.log(`  sheet total row ${p.sheetToDateCents === null ? "(none)" : fmt(p.sheetToDateCents).padStart(16)}`);
console.log(`\nlabour to date    ${fmt(p.labourToDateCents).padStart(16)}`);
const labourId = matchCostCodeId("Labour", refs);
console.log(`  → cost code     ${labourId ? `${labourId} ${codes.get(labourId)!.name}` : "*** no Labour cost code ***"}`);
console.log(`\nOPENING POSITION (base, ex margin/GST) ${fmt(p.toDateCents + p.labourToDateCents)}`);
console.log(`  grossed at 12.5% + 10%               ${fmt(Math.round((p.toDateCents + p.labourToDateCents) * 1.125 * 1.1))}`);

if (misses.length) {
  console.log(`\ntrades with spend but no budget line:`);
  for (const m of misses) console.log(`   - ${m}`);
}

// This tab's own period, for the double-count conversation.
console.log(`\nthis tab's CURRENT period: costs ${fmt(p.costsCents)}, labour ${fmt(p.labourCents)}, invoice total ${fmt(p.totalCents)}`);
const curAlloc = p.budgetOverview.reduce((a, b) => a + b.currentCents, 0);
console.log(`  Budget Overview "Current" column adds to ${fmt(curAlloc)}`);
if (Math.abs(curAlloc - p.costsCents) > 100) {
  console.log(`  *** ${fmt(Math.abs(p.costsCents - curAlloc))} of this month's supplier costs are NOT allocated to cost codes ***`);
}
