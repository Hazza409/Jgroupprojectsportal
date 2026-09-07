/**
 * End-to-end check of the mid-job opening position against real files, on the
 * LOCAL dev database. Seeds a throwaway project, imports the estimate the way
 * the estimate action does, carries the reconciliation position across the way
 * importOpeningPosition does, then reads the numbers back through the
 * dashboard's OWN budget maths. Deletes the project on the way out.
 *
 *   npx tsx scripts/test-opening.ts "<recon.xlsx>" "<estimate.xlsx>" [tab]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "../src/lib/db";
import { parseVariationPdfBuffer } from "../src/lib/pdf/parseVariationPdf";
import { parseEstimateBuffer } from "../src/lib/excel/parseEstimate";
import { parseReconciliationBuffer } from "../src/lib/excel/parseReconciliation";
import { computeCostToComplete, budgetPosition, matchCostCodeId, normalizeCostName, projectCodeRefs } from "../src/lib/claims";
import { formatCents } from "../src/lib/money";

const [reconPath, estPath, tab] = process.argv.slice(2);
const f = (c: number) => formatCents(c);

async function main() {
  // 8 Bower is a 12.5% job. Seeded with that override deliberately, while the
  // company default stays whatever it is, so this proves the per-project rate
  // is the one that reaches the figures.
  const project = await db.project.create({
    data: { name: "ZZ Opening-position test", address: "scratch", status: "ACTIVE", marginPercent: 12.5 },
  });
  // getProjectRates() memoises with React's cache(), which only exists inside
  // a Next render, so resolve the same way it does — company default with the
  // project's override applied — directly against the DB here.
  const companyDefault = await db.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const rates = {
    ...companyDefault,
    marginPercent: project.marginPercent ?? companyDefault.marginPercent,
  };
  console.log(`seeded project ${project.id}`);
  console.log(`company default margin ${companyDefault.marginPercent}%  →  job rate ${rates.marginPercent}%`);

  // ── 1. estimate → cost codes + approved budget
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
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitCostCents: l.unitCostCents,
      totalCents: l.totalCents,
      sortOrder: i,
    })),
  });
  console.log(`estimate: ${est.lines.length} lines, ${codeMap.size} cost codes, warnings ${est.warnings.length}`);

  // ── 2. reconciliation → opening position (mirrors importOpeningPosition)
  const parsed = parseReconciliationBuffer(readFileSync(reconPath), rates.marginPercent, rates.gstPercent, tab);
  console.log(`recon tab: "${parsed.sheetName}"`);
  for (const w of parsed.warnings) console.log(`  ! ${w}`);

  const rows = parsed.budgetOverview.map((b) => ({ name: b.name, cents: b.toDateCents }));
  if (parsed.labourToDateCents !== 0) rows.push({ name: "Labour", cents: parsed.labourToDateCents });

  const refs = await projectCodeRefs(project.id);
  let posted = 0;
  for (const row of rows) {
    if (row.cents === 0) continue;
    const costCodeId = matchCostCodeId(row.name, refs);
    await db.costActual.create({
      data: {
        projectId: project.id,
        costCodeId,
        // Keyed by source line, exactly as importOpeningPosition does, so
        // several lines can merge onto one cost code.
        xeroSourceId: `opening:${normalizeCostName(row.name)}`,
        description: `Opening position — ${row.name}`,
        amountCents: row.cents,
        occurredAt: parsed.meta.date ?? new Date(),
      },
    });
    posted++;
  }
  console.log(`posted ${posted} opening rows`);

  // ── 2b. merges the builder asked for (mirrors setCostCodeAlias)
  const MERGES: [string, string][] = [
    ["Mechanical", "1029"],
    ["Mechanical Ventilation", "1029"],
    ["Swimming Pool", "1064"],
  ];
  for (const [sourceLabel, code] of MERGES) {
    const cc = await db.costCode.findFirst({ where: { projectId: project.id, code }, select: { id: true, name: true } });
    if (!cc) {
      console.log(`  merge SKIPPED: no cost code ${code}`);
      continue;
    }
    const alias = normalizeCostName(sourceLabel);
    await db.costCodeAlias.create({ data: { projectId: project.id, costCodeId: cc.id, alias, sourceLabel } });
    const moved = await db.costActual.updateMany({
      where: { projectId: project.id, xeroSourceId: `opening:${alias}` },
      data: { costCodeId: cc.id },
    });
    console.log(`  merged "${sourceLabel}" → ${code} ${cc.name} (${moved.count} row moved)`);
  }

  // The matcher must now resolve those names WITHOUT any fuzzy help, so a
  // re-import lands them straight on the right code.
  const refs2 = await projectCodeRefs(project.id);
  for (const [sourceLabel] of MERGES) {
    const id = matchCostCodeId(sourceLabel, refs2);
    const hit = refs2.find((r) => r.id === id);
    console.log(`  matcher: "${sourceLabel}" → ${hit ? hit.name : "*** STILL UNMATCHED ***"}`);
  }

  // ── 2c. variation PDFs (mirrors commitVariationPdfs)
  const VAR_DIR = "/Users/harrymillard/Library/CloudStorage/Dropbox/8 Bower Street Manly New/09. Variations";
  const NOT_APPROVED = new Set([1008, 1050, 1079, 1082]); // per the builder
  let vApproved = 0;
  let vDraft = 0;
  let vApprovedCents = 0;
  const vWarn: string[] = [];
  for (const fname of readdirSync(VAR_DIR).filter((f) => /\.pdf$/i.test(f)).sort()) {
    const buf = readFileSync(join(VAR_DIR, fname));
    const v = await parseVariationPdfBuffer(buf, fname, rates.marginPercent);
    vWarn.push(...v.warnings);
    if (v.number === null) continue;
    const isApproved = !NOT_APPROVED.has(v.number);
    const varCode = matchCostCodeId(v.title, refs2);
    await db.variation.create({
      data: {
        projectId: project.id,
        variationNumber: v.number,
        title: v.title,
        description: [v.notes, `Source document: ${fname}`].filter(Boolean).join(" — "),
        status: isApproved ? "APPROVED" : "DRAFT",
        approvedAt: isApproved ? v.date : null,
        totalCents: v.totalCents,
        costCodeId: varCode,
        lines: {
          create: v.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unitCostCents: l.unitCostCents,
            totalCents: l.totalCents,
            costCodeId: matchCostCodeId(l.description, refs2) ?? varCode,
          })),
        },
      },
    });
    if (isApproved) {
      vApproved++;
      vApprovedCents += v.totalCents;
    } else vDraft++;
  }
  console.log(`\nvariations: ${vApproved} approved, ${vDraft} draft, warnings ${vWarn.length}`);
  console.log(`  approved base ${f(vApprovedCents)}  → client ${f(Math.round(vApprovedCents * 1.125 * 1.1))}`);

  // ── 3. read it back through the dashboard's own maths
  const ctc = await computeCostToComplete(project.id, rates);
  const pos = await budgetPosition(project.id, ctc);

  for (const code of ["1029", "1064"]) {
    const r = ctc.rows.find((x) => x.code === code);
    if (r) console.log(`\n  ${r.code} ${r.name}: budget ${f(r.revisedCents)}  spent ${f(r.currentCents)}`);
  }

  console.log(`\n${"— as the Budget tab computes it —".padStart(46)}`);
  console.log(`  original estimate        ${f(pos.estimateCents).padStart(16)}`);
  console.log(`  approved variations      ${f(pos.variationsCents).padStart(16)}`);
  console.log(`  approved budget          ${f(pos.approvedBudgetCents).padStart(16)}`);
  console.log(`  forecast final cost      ${f(pos.forecastCents).padStart(16)}`);
  console.log(`  spent to date            ${f(pos.spentCents).padStart(16)}`);
  console.log(`  remaining to forecast    ${f(pos.remainingToForecastCents).padStart(16)}`);
  console.log(`  % of forecast used       ${pos.pctOfForecast.toFixed(1).padStart(15)}%`);

  const over = ctc.rows.filter((r) => r.varianceCents < 0);
  console.log(`\n  cost codes over budget: ${over.length}`);
  for (const r of over.sort((a, b) => a.varianceCents - b.varianceCents).slice(0, 8)) {
    const budget = r.forecastCents ?? r.revisedCents; // same rule the Budget tab uses
    console.log(`    ${(r.code + " " + r.name).slice(0, 34).padEnd(34)} budget ${f(budget).padStart(14)}  spent ${f(r.currentCents).padStart(14)}  over ${f(-r.varianceCents).padStart(13)}`);
  }
  const unalloc = ctc.rows.find((r) => !r.id);
  if (unalloc) console.log(`\n  unallocated: ${f(unalloc.currentCents)}`);

  await db.project.delete({ where: { id: project.id } });
  console.log(`\ncleaned up ${project.id}`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
