import * as XLSX from "xlsx";
import { dollarsToCents } from "../money";

// ── J Group reconciliation sheet parser ──────────────────────
// One tab per invoice (e.g. "Invoice 49 - Apr-26"). Structure:
//   • Metadata row:  Job: … | <Xero Inv ref> | <date>
//   • Supplier detail: Supplier | Document Number | Budget Allocation | Amount(ex-GST)
//   • Budget Overview: <cost code> | Current | Prior | To Date
//   • Labour Hours → "Per Invoice" row = labour this period
//   • Builder's Margin, GST, Total amount per invoice
// Anchored on label strings, so it tolerates row shifts between months.

export interface ReconSupplierLine {
  supplier: string;
  documentNumber: string | null;
  allocation: string | null;
  amountCents: number;
}
export interface ReconBudgetLine {
  name: string;
  currentCents: number;
  priorCents: number;
  toDateCents: number;
}
export interface ParsedRecon {
  meta: { job: string | null; invoiceRef: string | null; date: Date | null; periodLabel: string | null; invoiceNumber: number | null };
  supplierLines: ReconSupplierLine[];
  budgetOverview: ReconBudgetLine[];
  costsCents: number;
  labourCents: number;
  marginPercent: number;
  marginCents: number;
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  warnings: string[];
}

const s = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const cents = (v: unknown) => dollarsToCents((num(v) ?? 0).toString());

// Normalize label text for matching: lowercase, drop apostrophes (so
// "builder's" == "builders"), collapse whitespace. Guards against the sheet's
// inconsistent apostrophe use breaking margin/GST lookups.
const norm = (v: unknown) => s(v).toLowerCase().replace(/['’`]/g, "").replace(/\s+/g, " ").trim();

// Find the first cell (any column) whose text contains `needle`. Returns row+col
// so values can be read relative to the label (the sheet may omit column A).
function findCell(rows: unknown[][], needle: string, from = 0): { r: number; c: number } | null {
  const n = norm(needle);
  for (let r = from; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (norm(row[c]).includes(n)) return { r, c };
    }
  }
  return null;
}

// Find a row whose cell IN A SPECIFIC COLUMN exactly equals `needle` — used for
// the supplier "Total" row so a supplier literally named "Total Tools" can't
// hijack it.
function findRowInColumn(rows: unknown[][], col: number, needle: string, from = 0): number | null {
  const n = norm(needle);
  for (let r = from; r < rows.length; r++) {
    if (norm((rows[r] ?? [])[col]) === n) return r;
  }
  return null;
}

function pickSheet(wb: XLSX.WorkBook): { name: string; rows: unknown[][] } | null {
  // Prefer a tab named like an invoice; else the densest sheet.
  const named = wb.SheetNames.find((n) => /invoice/i.test(n));
  const candidates = named ? [named, ...wb.SheetNames] : wb.SheetNames;
  let best: { name: string; rows: unknown[][] } | null = null;
  for (const name of candidates) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: true });
    const filled = rows.reduce((a, r) => a + r.filter((c) => c !== null && c !== "").length, 0);
    if (!best || filled > best.rows.reduce((a, r) => a + r.filter((c) => c !== null && c !== "").length, 0)) {
      best = { name, rows };
    }
    if (named && name === named && filled > 5) break;
  }
  return best;
}

export function parseReconciliationBuffer(buf: Buffer, defaultMarginPercent = 12.5, defaultGstPercent = 10): ParsedRecon {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const picked = pickSheet(wb);
  const warnings: string[] = [];
  const empty: ParsedRecon = {
    meta: { job: null, invoiceRef: null, date: null, periodLabel: null, invoiceNumber: null },
    supplierLines: [], budgetOverview: [], costsCents: 0, labourCents: 0,
    marginPercent: defaultMarginPercent, marginCents: 0, subtotalCents: 0, gstCents: 0, totalCents: 0, warnings,
  };
  if (!picked) { warnings.push("No worksheet found."); return empty; }
  const { name, rows } = picked;

  // Metadata
  const meta = empty.meta;
  const jobCell = findCell(rows, "job");
  if (jobCell) {
    meta.job = s(rows[jobCell.r][jobCell.c + 1]) || null;
    meta.invoiceRef = s(rows[jobCell.r][jobCell.c + 2]) || null;
    const dv = rows[jobCell.r][jobCell.c + 3];
    meta.date = dv instanceof Date ? dv : null;
  }
  const tabMatch = name.match(/invoice\s*(\d+)\s*-\s*([A-Za-z]+-?\d+)/i);
  meta.invoiceNumber = tabMatch ? Number(tabMatch[1]) : null;
  meta.periodLabel = tabMatch ? tabMatch[2] : null;

  // Supplier detail (Supplier | Doc # | Allocation | Amount). `base` = label column.
  const supHdrCell = findCell(rows, "supplier");
  const supplierLines: ReconSupplierLine[] = [];
  if (supHdrCell) {
    const base = supHdrCell.c;
    for (let r = supHdrCell.r + 1; r < rows.length; r++) {
      const label = s(rows[r][base]).toLowerCase();
      if (!label) continue;
      if (label === "total" || label.startsWith("closed") || label.startsWith("budget overview")) break;
      if (num(rows[r][base + 3]) === null) continue;
      supplierLines.push({
        supplier: s(rows[r][base]),
        documentNumber: s(rows[r][base + 1]) || null,
        allocation: s(rows[r][base + 2]) || null,
        amountCents: cents(rows[r][base + 3]),
      });
    }
  }

  // Budget Overview (cost code | Current | Prior | To Date)
  const boCell = findCell(rows, "budget overview");
  const budgetOverview: ReconBudgetLine[] = [];
  if (boCell) {
    const base = boCell.c;
    for (let r = boCell.r + 1; r < rows.length; r++) {
      const label = s(rows[r][base]);
      if (!label) break; // totals row has empty label → stop
      if (/labour hours/i.test(label)) break;
      if (num(rows[r][base + 1]) === null && num(rows[r][base + 2]) === null && num(rows[r][base + 3]) === null) continue;
      budgetOverview.push({
        name: label,
        currentCents: cents(rows[r][base + 1]),
        priorCents: cents(rows[r][base + 2]),
        toDateCents: cents(rows[r][base + 3]),
      });
    }
  }

  // Labour this period — "Per Invoice" row, Current column (label col + 1).
  const labCell = findCell(rows, "per invoice");
  const labourCents = labCell ? cents(rows[labCell.r][labCell.c + 1]) : 0;

  // Costs this period — the supplier "Total" row (exact match in the supplier
  // LABEL column so a supplier named "Total Tools" can't hijack it), else sum.
  const costsTotalRow = supHdrCell ? findRowInColumn(rows, supHdrCell.c, "total", supHdrCell.r + 1) : null;
  const costsCents =
    costsTotalRow !== null && num(rows[costsTotalRow][supHdrCell!.c + 3]) !== null
      ? cents(rows[costsTotalRow][supHdrCell!.c + 3])
      : supplierLines.reduce((a, l) => a + l.amountCents, 0);

  // Builder's margin (value column is 3 right of the label, like column E).
  const marginHdrCell = findCell(rows, "builders margin current invoice");
  const marginPct = marginHdrCell ? Number(s(rows[marginHdrCell.r][marginHdrCell.c]).match(/([\d.]+)\s*%/)?.[1]) : NaN;
  const marginPercent = Number.isFinite(marginPct) ? marginPct : defaultMarginPercent;
  const marginCell = findCell(rows, "total builder's margin per invoice");
  const marginCents = marginCell ? cents(rows[marginCell.r][marginCell.c + 3]) : Math.round((labourCents + costsCents) * (marginPercent / 100));

  // GST + total
  const gstCell = findCell(rows, "gst this invoice");
  const gstCents = gstCell ? cents(rows[gstCell.r][gstCell.c + 3]) : Math.round((labourCents + costsCents + marginCents) * (defaultGstPercent / 100));
  const totalCell = findCell(rows, "total amount per invoice");
  const subtotalCents = labourCents + costsCents + marginCents;
  const totalCents = totalCell ? cents(rows[totalCell.r][totalCell.c + 3]) : subtotalCents + gstCents;

  if (supplierLines.length === 0 && budgetOverview.length === 0) {
    warnings.push("Could not find supplier or budget-overview rows — check the sheet matches the expected reconciliation format.");
  }

  return { meta, supplierLines, budgetOverview, costsCents, labourCents, marginPercent, marginCents, subtotalCents, gstCents, totalCents, warnings };
}
