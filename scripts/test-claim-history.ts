/**
 * End-to-end check of the claim-history import on the LOCAL dev database.
 * Seeds a throwaway project, imports the estimate, then replays every invoice
 * tab as an approved claim exactly as importClaimHistory does, and reads the
 * position back through the app's own budget maths.
 *
 *   npx tsx scripts/test-claim-history.ts "<recon.xlsx>" "<estimate.xlsx>" [upTo]
 */
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { parseEstimateBuffer } from "../src/lib/excel/parseEstimate";
import { listReconTabs, parseReconciliationBuffer } from "../src/lib/excel/parseReconciliation";
import {
  computeCostToComplete,
  budgetPosition,
  matchCostCodeId,
  materializeClaimActuals,
  projectCodeRefs,
} from "../src/lib/claims";
import { formatCents } from "../src/lib/money";

const [reconPath, estPath, upToArg] = process.argv.slice(2);
const upTo = Number(upToArg ?? 54);
const f = (c: number) => formatCents(c);

function swapDayMonth(d: Date): Date | null {
  const day = d.getDate();
  if (day < 1 || day > 12) return null;
  const s = new Date(d.getFullYear(), day - 1, d.getMonth() + 1);
  return Number.isNaN(s.getTime()) ? null : s;
}

async function main() {
  const project = await db.project.create({
    data: { name: "ZZ claim-history test", status: "ACTIVE", marginPercent: 12.5 },
  });
  const company = await db.company.findFirstOrThrow();
  const rates = { ...company, marginPercent: project.marginPercent ?? company.marginPercent };
  console.log(`seeded ${project.id}  (margin ${rates.marginPercent}%)`);

  // estimate → cost codes
  const est = parseEstimateBuffer(readFileSync(estPath));
  const nameByCode = new Map<string, string>();
  for (const l of est.lines) if (l.costCode && l.costCodeName && !nameByCode.has(l.costCode)) nameByCode.set(l.costCode, l.costCodeName);
  const codeMap = new Map<string, string>();
  for (const [code, name] of nameByCode) {
    const cc = await db.costCode.create({ data: { projectId: project.id, code, name } });
    codeMap.set(code, cc.id);
  }
  await db.estimateLineItem.createMany({
    data: est.lines.map((l, i) => ({
      projectId: project.id,
      costCodeId: l.costCode ? codeMap.get(l.costCode) ?? null : null,
      description: l.description, quantity: l.quantity, unit: l.unit,
      unitCostCents: l.unitCostCents, totalCents: l.totalCents, sortOrder: i,
    })),
  });
  console.log(`estimate: ${est.lines.length} lines, ${codeMap.size} cost codes`);

  // parse all tabs in order, repair backwards dates
  const buf = readFileSync(reconPath);
  const tabs = (listReconTabs(buf).filter((t) => t.invoiceNumber !== null) as { name: string; invoiceNumber: number }[])
    .sort((a, b) => a.invoiceNumber - b.invoiceNumber);
  const rows = tabs.map((t) => ({
    tab: t.name,
    invoiceNumber: t.invoiceNumber,
    p: parseReconciliationBuffer(buf, rates.marginPercent, rates.gstPercent, t.name),
    dateFixed: false,
  }));
  let prev: Date | null = null;
  for (const r of rows) {
    const d = r.p.meta.date;
    if (d && prev && d <= prev) {
      const s = swapDayMonth(d);
      if (s && s > prev) { r.p.meta.date = s; r.dateFixed = true; }
    }
    if (r.p.meta.date) prev = r.p.meta.date;
  }
  const fixed = rows.filter((r) => r.dateFixed);
  console.log(`tabs: ${rows.length}   dates corrected: ${fixed.length} (${fixed.map((r) => "#" + r.invoiceNumber).join(", ")})`);

  const codes = await projectCodeRefs(project.id);
  let created = 0, invoiced = 0;
  for (const r of rows.filter((x) => x.invoiceNumber <= upTo)) {
    const p = r.p;
    const claim = await db.progressClaim.create({
      data: {
        projectId: project.id, claimNumber: r.invoiceNumber, status: "APPROVED",
        periodEnd: p.meta.date ?? undefined, approvedAt: p.meta.date ?? undefined,
        periodLabel: p.meta.periodLabel, reconInvoiceRef: p.meta.invoiceRef,
        reconSheetName: `sheet — ${r.tab}`,
        labourCents: p.labourCents, costsCents: p.costsCents, marginPercent: p.marginPercent,
        marginCents: p.marginCents, subtotalCents: p.subtotalCents, gstCents: p.gstCents, totalCents: p.totalCents,
        lines: { create: p.budgetOverview.filter((b) => b.currentCents !== 0).map((b) => ({
          costCodeId: matchCostCodeId(b.name, codes), description: b.name,
          claimedAmountCents: b.currentCents, priorCents: b.priorCents, toDateCents: b.toDateCents,
        })) },
        reconLines: { create: p.supplierLines.map((l) => ({
          supplier: l.supplier, documentNumber: l.documentNumber, allocation: l.allocation, amountCents: l.amountCents,
        })) },
      },
    });
    await materializeClaimActuals(project.id, claim.id);
    created++; invoiced += p.totalCents;
  }
  console.log(`claims created: ${created}   invoiced total: ${f(invoiced)}`);

  const ctc = await computeCostToComplete(project.id, rates);
  const pos = await budgetPosition(project.id, ctc);
  console.log(`\n  original estimate      ${f(pos.estimateCents).padStart(16)}`);
  console.log(`  spent to date          ${f(pos.spentCents).padStart(16)}`);
  console.log(`  unallocated            ${f(ctc.unallocated.currentCents).padStart(16)}`);
  console.log(`  spent == invoiced?     ${pos.spentCents === invoiced ? "YES" : `NO (diff ${f(pos.spentCents - invoiced)})`}`);

  const over = ctc.rows.filter((r) => r.varianceCents < 0).sort((a, b) => a.varianceCents - b.varianceCents);
  console.log(`\n  cost codes over budget: ${over.length}`);
  for (const r of over.slice(0, 6)) {
    console.log(`    ${(r.code + " " + r.name).slice(0, 34).padEnd(34)} budget ${f(r.revisedCents).padStart(14)}  spent ${f(r.currentCents).padStart(14)}`);
  }

  await db.project.delete({ where: { id: project.id } });
  console.log(`\ncleaned up`);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).finally(() => db.$disconnect());
