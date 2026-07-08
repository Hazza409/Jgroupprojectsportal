import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { inclMarginGst } from "@/lib/money";
import { computeCostToComplete, projectDrawdown, claimHeadlineCents } from "@/lib/claims";

type Company = { name: string; marginPercent: number; gstPercent: number };
type Row = (string | number | null)[];

// Cents → dollars as a real number so Excel can SUM/format it (not a string).
const d = (cents: number) => Math.round(cents) / 100;
const fmtDate = (dt: Date | null | undefined) =>
  dt ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(dt) : "";

/** Append a sheet built from an array-of-arrays, auto-sizing columns. */
function addSheet(wb: XLSX.WorkBook, name: string, aoa: Row[]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Column widths from the widest cell in each column (capped).
  const widths: number[] = [];
  for (const row of aoa) {
    row.forEach((cell, i) => {
      const len = cell === null || cell === undefined ? 0 : String(cell).length;
      widths[i] = Math.min(48, Math.max(widths[i] ?? 10, len + 2));
    });
  }
  ws["!cols"] = widths.map((wch) => ({ wch }));
  // Sheet names: max 31 chars, no []:*?/\
  const safe = name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, safe);
}

/**
 * Build a multi-tab .xlsx with everything on a project: a summary, the full
 * Cost to Complete table (identical numbers to the on-screen page — same
 * computeCostToComplete), the estimate, every variation's line items with cost
 * codes, the progress-claim register with drawdown, and the schedule. All money
 * is client-facing (incl builder's margin + GST) to match the dashboard.
 */
export async function buildProjectWorkbook(projectId: string, company: Company): Promise<{ buffer: Buffer; filename: string }> {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true, address: true, clientName: true, status: true },
  });

  const [ctc, drawdown, estimateLines, variations, claims, schedule] = await Promise.all([
    computeCostToComplete(projectId, company),
    projectDrawdown(projectId, company),
    db.estimateLineItem.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { description: true, quantity: true, unit: true, unitCostCents: true, totalCents: true, costCode: { select: { code: true, name: true } } },
    }),
    db.variation.findMany({
      where: { projectId },
      orderBy: { variationNumber: "asc" },
      select: {
        variationNumber: true, title: true, status: true, totalCents: true,
        lines: { orderBy: { id: "asc" }, select: { description: true, quantity: true, unit: true, totalCents: true, costCode: { select: { code: true, name: true } } } },
      },
    }),
    db.progressClaim.findMany({
      where: { projectId },
      orderBy: { claimNumber: "asc" },
      select: { claimNumber: true, periodLabel: true, status: true, approvedAt: true, totalCents: true, lines: { select: { claimedAmountCents: true } } },
    }),
    db.scheduleItem.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { group: true, taskName: true, startDate: true, endDate: true, durationDays: true, percentComplete: true },
    }),
  ]);

  const wb = XLSX.utils.book_new();

  // ── Summary ──
  addSheet(wb, "Summary", [
    [company.name],
    ["Project", project.name],
    ["Address", project.address ?? ""],
    ["Client", project.clientName ?? ""],
    ["Status", project.status],
    ["Exported", fmtDate(new Date())],
    [],
    ["All amounts include builder's margin and GST", `${company.marginPercent}% margin, ${company.gstPercent}% GST`],
    [],
    ["Original estimate", d(ctc.totals.estimateCents)],
    ["Approved variations", d(ctc.totals.variationsCents)],
    ["Revised estimate", d(ctc.totals.revisedCents)],
    ["Current cost to date", d(ctc.totals.currentCents)],
    ["Cost to complete", d(ctc.totals.costToCompleteCents)],
    [],
    ["Contract budget (drawdown)", d(drawdown.budgetCents)],
    ["Drawn down (approved claims)", d(drawdown.drawnCents)],
    ["Remaining to draw", d(drawdown.remainingCents)],
  ]);

  // ── Cost to Complete ──
  const ctcRows: Row[] = [["Code", "Cost Item", "Estimate", "Variations", "Revised", "Current to Date", "Variance"]];
  for (const r of ctc.rows) {
    ctcRows.push([r.code, r.name, d(r.estimateCents), d(r.variationsCents), d(r.revisedCents), d(r.currentCents), d(r.varianceCents)]);
  }
  const u = ctc.unallocated;
  if (u.estimateCents || u.variationsCents || u.currentCents) {
    ctcRows.push([
      "—", "Unallocated (no matching cost code)",
      d(u.estimateCents), d(u.variationsCents), d(u.estimateCents + u.variationsCents), d(u.currentCents),
      d(u.estimateCents + u.variationsCents - u.currentCents),
    ]);
  }
  ctcRows.push([
    "", "TOTAL",
    d(ctc.totals.estimateCents), d(ctc.totals.variationsCents), d(ctc.totals.revisedCents),
    d(ctc.totals.currentCents), d(ctc.totals.costToCompleteCents),
  ]);
  addSheet(wb, "Cost to Complete", ctcRows);

  // ── Estimate ──
  const estRows: Row[] = [["Cost Code", "Cost Item", "Line Description", "Qty", "Unit", "Unit Cost (base)", "Line Total (base)", "Line Total (incl margin+GST)"]];
  for (const l of estimateLines) {
    estRows.push([
      l.costCode?.code ?? "", l.costCode?.name ?? "", l.description, l.quantity, l.unit ?? "",
      d(l.unitCostCents), d(l.totalCents), d(inclMarginGst(l.totalCents, company)),
    ]);
  }
  addSheet(wb, "Estimate", estRows);

  // ── Variations (one row per line item) ──
  const varRows: Row[] = [["VO #", "Title", "Status", "Line Description", "Cost Code", "Qty", "Unit", "Amount (base)", "Amount (incl margin+GST)"]];
  for (const v of variations) {
    if (v.lines.length === 0) {
      varRows.push([v.variationNumber, v.title, v.status, "", "", "", "", d(v.totalCents), d(inclMarginGst(v.totalCents, company))]);
    } else {
      for (const l of v.lines) {
        varRows.push([
          v.variationNumber, v.title, v.status, l.description,
          l.costCode ? `${l.costCode.code} · ${l.costCode.name}` : "",
          l.quantity, l.unit ?? "", d(l.totalCents), d(inclMarginGst(l.totalCents, company)),
        ]);
      }
    }
  }
  addSheet(wb, "Variations", varRows);

  // ── Progress Claims (with drawdown) ──
  const claimRows: Row[] = [["Claim #", "Period", "Status", "Approved", "Amount (incl GST)", "Drawn to Date", "Remaining"]];
  const drawByNum = new Map(drawdown.rows.map((r) => [r.claimNumber, r]));
  for (const c of claims) {
    const dr = drawByNum.get(c.claimNumber);
    claimRows.push([
      c.claimNumber, c.periodLabel ?? "", c.status, fmtDate(c.approvedAt),
      d(claimHeadlineCents(c, company)),
      dr?.drawnToDateCents != null ? d(dr.drawnToDateCents) : "",
      dr?.remainingCents != null ? d(dr.remainingCents) : "",
    ]);
  }
  addSheet(wb, "Progress Claims", claimRows);

  // ── Schedule ──
  const schedRows: Row[] = [["Phase", "Task", "Start", "Finish", "Duration (days)", "% Complete"]];
  for (const s of schedule) {
    schedRows.push([s.group ?? "", s.taskName, fmtDate(s.startDate), fmtDate(s.endDate), s.durationDays, s.percentComplete]);
  }
  addSheet(wb, "Schedule", schedRows);

  const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const safeName = project.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  return { buffer, filename: `${safeName}-export.xlsx` };
}
