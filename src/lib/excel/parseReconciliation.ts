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
  /** Which tab was actually read. */
  sheetName: string;
  supplierLines: ReconSupplierLine[];
  budgetOverview: ReconBudgetLine[];
  costsCents: number;
  labourCents: number;
  /** Labour "Per Invoice" row, To Date column — cumulative labour for the job. */
  labourToDateCents: number;
  /** Budget-overview rows summed by us (authoritative). */
  toDateCents: number;
  /**
   * The sheet's OWN total-row figure for To Date, when it has one. Kept
   * separately because a hand-maintained SUM range drifts out of step with the
   * rows above it, and the caller should be told rather than silently handed
   * one number or the other.
   */
  sheetToDateCents: number | null;
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

/** Invoice number out of a tab name: "Invoice 55 - Aug-26(2)", "Inv 7 - Mar(1)-24". */
export function tabInvoiceNumber(name: string): number | null {
  // Deliberately loose about what follows "inv": real workbooks contain
  // "Invvoice 27" and "Inv41" alongside "Invoice 27", and a tab whose number
  // doesn't parse is skipped by the history import — losing a whole month's
  // money silently. LETTERS only after "inv", never \w: \w swallows digits, so
  // "Inv41" would greedily read as invoice 4 and then 1.
  const m = /^\s*inv[a-z]*\s*(\d+)\b/i.exec(name.trim());
  return m ? Number(m[1]) : null;
}

/** Every invoice tab in a reconciliation workbook, newest first. */
export function listReconTabs(buf: Buffer): { name: string; invoiceNumber: number | null }[] {
  const wb = XLSX.read(buf, { type: "buffer", bookSheets: true });
  return wb.SheetNames.map((name) => ({ name, invoiceNumber: tabInvoiceNumber(name) })).sort(
    (a, b) => (b.invoiceNumber ?? -1) - (a.invoiceNumber ?? -1),
  );
}

function pickSheet(wb: XLSX.WorkBook, sheetName?: string): { name: string; rows: unknown[][] } | null {
  const read = (name: string) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: true }),
  });

  // An explicit tab always wins — a running workbook holds every month of the
  // job, and guessing which one the builder meant is not acceptable.
  if (sheetName && wb.Sheets[sheetName]) return read(sheetName);

  // Otherwise the HIGHEST invoice number, which is the current period. Taking
  // the first tab matching /invoice/i instead only worked while the workbook
  // happened to be ordered newest-first; re-order the tabs and it would
  // silently import a two-year-old month.
  const numbered = wb.SheetNames.map((n) => ({ n, i: tabInvoiceNumber(n) }))
    .filter((x): x is { n: string; i: number } => x.i !== null)
    .sort((a, b) => b.i - a.i);
  if (numbered.length > 0) return read(numbered[0].n);

  // No invoice-looking tab at all: fall back to the densest sheet.
  const filled = (rows: unknown[][]) => rows.reduce((a, r) => a + r.filter((c) => c !== null && c !== "").length, 0);
  let best: { name: string; rows: unknown[][] } | null = null;
  for (const name of wb.SheetNames) {
    const cur = read(name);
    if (!best || filled(cur.rows) > filled(best.rows)) best = cur;
  }
  return best;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Month index + year out of a period label like "Aug-26", "Sept-24", "mar-26". */
function periodMonthYear(label: string | null): { month: number; year: number } | null {
  if (!label) return null;
  const m = /^([A-Za-z]{3,})\s*-?\s*(\d{2,4})?/.exec(label.trim());
  if (!m) return null;
  const month = MONTHS.findIndex((x) => m[1].toLowerCase().startsWith(x));
  if (month < 0) return null;
  const raw = m[2] ? Number(m[2]) : NaN;
  if (!Number.isFinite(raw)) return null;
  return { month, year: raw < 100 ? 2000 + raw : raw };
}

/**
 * A progress claim is raised in, or shortly after, the period it covers. Score
 * a candidate date by how far it falls outside that window — 0 is ideal, and
 * bigger is worse. Used to choose between a stored date and its day/month swap.
 */
function periodFit(d: Date, period: { month: number; year: number }): number {
  const monthsAfter = (d.getFullYear() - period.year) * 12 + (d.getMonth() - period.month);
  if (monthsAfter < 0) return 1 - monthsAfter; // before the work: always wrong
  if (monthsAfter > 1) return monthsAfter - 1; // long after: suspicious
  return 0; // same month or the next one
}

/**
 * The invoice date off the metadata row.
 *
 * Two things go wrong with this cell in a long-running workbook:
 *
 *  1. Early tabs hold it as TEXT ("14/12/23"), which a plain `instanceof Date`
 *     check threw away — losing the date on most of the job.
 *  2. Later tabs hold a real date that Excel produced by reading a typed
 *     "08/02/2024" in US month-first order, so day and month are swapped and
 *     the claim is dated months from the work it covers.
 *
 * Text is parsed day-first, which is unambiguous for how these are written.
 * For a real date, the day/month swap is only applied when the tab's own
 * period proves it — the swap has to fit the period better than the stored
 * value does. Anything less certain is left alone and reported.
 */
function resolveInvoiceDate(
  cell: unknown,
  periodLabel: string | null,
  tabName: string,
  warnings: string[],
): Date | null {
  const fmt = (d: Date) => d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });

  if (typeof cell === "string") {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(cell.trim());
    if (!m) return null;
    const [dd, mm, yy] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const d = new Date(yy < 100 ? 2000 + yy : yy, mm - 1, dd);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (!(cell instanceof Date) || Number.isNaN(cell.getTime())) return null;

  const period = periodMonthYear(periodLabel);
  if (!period) return cell; // nothing to check it against

  const day = cell.getDate();
  const stored = periodFit(cell, period);
  // A swap is only possible when the day could itself be a month.
  if (day >= 1 && day <= 12) {
    const swapped = new Date(cell.getFullYear(), day - 1, cell.getMonth() + 1);
    if (!Number.isNaN(swapped.getTime()) && periodFit(swapped, period) < stored) {
      warnings.push(
        `Invoice date on "${tabName}" reads ${fmt(cell)}, which doesn't fit a ${periodLabel} claim. ` +
          `Day and month look transposed (Excel reading a typed date month-first), so ${fmt(swapped)} ` +
          `has been used. Worth correcting in the spreadsheet.`,
      );
      return swapped;
    }
  }
  if (stored > 1) {
    warnings.push(
      `Invoice date on "${tabName}" reads ${fmt(cell)} but the tab covers ${periodLabel}. Used as-is — check it.`,
    );
  }
  return cell;
}

export function parseReconciliationBuffer(
  buf: Buffer,
  defaultMarginPercent = 12.5,
  defaultGstPercent = 10,
  sheetName?: string,
): ParsedRecon {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const picked = pickSheet(wb, sheetName);
  const warnings: string[] = [];
  const empty: ParsedRecon = {
    meta: { job: null, invoiceRef: null, date: null, periodLabel: null, invoiceNumber: null },
    sheetName: picked?.name ?? "",
    supplierLines: [], budgetOverview: [], costsCents: 0, labourCents: 0,
    labourToDateCents: 0, toDateCents: 0, sheetToDateCents: null,
    marginPercent: defaultMarginPercent, marginCents: 0, subtotalCents: 0, gstCents: 0, totalCents: 0, warnings,
  };
  if (!picked) { warnings.push("No worksheet found."); return empty; }
  const { name, rows } = picked;

  // Metadata. The tab name is read FIRST: its period ("Aug-26") is the one
  // piece of dating on the sheet that can't be mangled by Excel, so it's the
  // evidence used to sanity-check the date cell below.
  const meta = empty.meta;
  // Tab names drift over a long job: "Invoice 55 - Aug-26(2)", "Inv 43 -
  // Nov-25(1)", "Invoice 29 - Apr(2)", plain "Inv 1". Requiring the full word
  // "invoice" AND a month-year lost the invoice number on every "Inv N" tab —
  // and the number is what orders the claim sequence, so losing it silently
  // disabled the out-of-sequence guard. Take the number on its own, then the
  // period label as a best effort.
  // The number comes from tabInvoiceNumber so there is ONE definition of what
  // an invoice tab is called — a second copy here drifted out of step with it
  // and left "Invvoice 27" numberless while the tab lister found it fine.
  meta.invoiceNumber = tabInvoiceNumber(name);
  const rest = /^\s*inv[a-z]*\s*\d+\s*[-–—]\s*(.+)$/i.exec(name.trim())?.[1]?.trim() ?? "";
  // Prefer a clean "Aug-26" out of "Aug-26(2)"; else keep whatever's there.
  meta.periodLabel = /([A-Za-z]{3,}\s*-?\s*\d{2,4})/.exec(rest)?.[1] ?? (rest || null);

  const jobCell = findCell(rows, "job");
  if (jobCell) {
    meta.job = s(rows[jobCell.r][jobCell.c + 1]) || null;
    meta.invoiceRef = s(rows[jobCell.r][jobCell.c + 2]) || null;
    meta.date = resolveInvoiceDate(rows[jobCell.r][jobCell.c + 3], meta.periodLabel, name, warnings);
  }

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
  let boStopRow: number | null = null;
  if (boCell) {
    const base = boCell.c;
    for (let r = boCell.r + 1; r < rows.length; r++) {
      const label = s(rows[r][base]);
      if (!label) { boStopRow = r; break; } // totals row has empty label → stop
      if (/labour hours/i.test(label)) { boStopRow = r; break; }
      if (num(rows[r][base + 1]) === null && num(rows[r][base + 2]) === null && num(rows[r][base + 3]) === null) continue;
      budgetOverview.push({
        name: label,
        currentCents: cents(rows[r][base + 1]),
        priorCents: cents(rows[r][base + 2]),
        toDateCents: cents(rows[r][base + 3]),
      });
    }
  }

  // Labour — "Per Invoice" row: Current at label col + 1, To Date at + 3.
  const labCell = findCell(rows, "per invoice");
  const labourCents = labCell ? cents(rows[labCell.r][labCell.c + 1]) : 0;
  const labourToDateCents = labCell ? cents(rows[labCell.r][labCell.c + 3]) : 0;

  // Cumulative cost to date. We SUM THE ROWS rather than read the sheet's own
  // total: on a long job, cost codes get appended below a hand-written SUM
  // range and the total silently stops counting them. Both figures are
  // returned, and a mismatch is warned about — the rows are what we trust.
  const toDateCents = budgetOverview.reduce((a, b) => a + b.toDateCents, 0);
  const sheetToDateCents =
    boCell && boStopRow !== null && num(rows[boStopRow]?.[boCell.c + 3]) !== null
      ? cents(rows[boStopRow][boCell.c + 3])
      : null;
  // Only worth reporting when the sheet HAS a total and it's short: a blank or
  // zero total row (common on the earliest tabs of an old job) is just not
  // filled in, and we use the row values regardless.
  if (sheetToDateCents !== null && sheetToDateCents > 0 && Math.abs(sheetToDateCents - toDateCents) > 100) {
    const diff = (Math.abs(toDateCents - sheetToDateCents) / 100).toLocaleString("en-AU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    warnings.push(
      `Budget Overview total row disagrees with its own cost-code rows by $${diff} on "${name}" — ` +
        `the rows add to more than the total claims. Its SUM range probably stops short of the last ` +
        `cost code(s). Using the row values; check the spreadsheet formula.`,
    );
  }

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
  } else if (budgetOverview.length === 0) {
    // Warn on EACH section independently. Requiring both to be missing hid the
    // worst case: the supplier side parses, so the claim's money is right and
    // the import reports success, but with no budget-overview rows there is
    // nothing to split it by cost code — the whole claim lands in Cost to
    // Complete as one Unallocated lump, silently.
    warnings.push(
      "No Budget Overview rows found, so this claim can't be split by cost code — " +
        "its costs will show against Unallocated on the Budget tab. Check the sheet has a " +
        "'Budget Overview' heading with the cost-code rows directly beneath it.",
    );
  } else if (supplierLines.length === 0) {
    warnings.push("No supplier invoice rows found — the supplier backup for this claim will be empty.");
  }

  return {
    meta, sheetName: name, supplierLines, budgetOverview, costsCents, labourCents,
    labourToDateCents, toDateCents, sheetToDateCents,
    marginPercent, marginCents, subtotalCents, gstCents, totalCents, warnings,
  };
}
