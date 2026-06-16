import * as XLSX from "xlsx";
import { dollarsToCents } from "../money";
import type { ParsedCostRow } from "./parseCurrentCosts";

// ── J Group "Cost to Complete Workings" workbook parser ──────
// Two side-by-side blocks share a header row:
//   "Current Costs to Date":  Code | Cost Item | Amount
//   "Estimate Schedule":      Code | Estimate Line | Amount | Variance
// Plus an "Approved Variations" block (Variation | Amount) we surface separately.
// Amounts are the ex-margin / ex-GST base — the app grosses up for display.

export interface ParsedCtcVariation {
  title: string;
  amountCents: number | null; // null = "Draft" / unpriced
}
export interface ParsedCtcWorkbook {
  rows: ParsedCostRow[];
  variations: ParsedCtcVariation[];
  warnings: string[];
}

const s = (v: unknown) => String(v ?? "").trim();
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function findCell(grid: unknown[][], needle: string): { r: number; c: number } | null {
  const n = needle.toLowerCase();
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) if (s(row[c]).toLowerCase() === n) return { r, c };
  }
  return null;
}

/** Read a Code | Name | Amount block starting just below `headerRow` at column `base`.
 * A blank / "-" amount stays null (don't coerce to $0 — that would overwrite the
 * estimate/current with zero on import). */
function readBlock(grid: unknown[][], headerRow: number, base: number): Map<string, { name: string; cents: number | null }> {
  const out = new Map<string, { name: string; cents: number | null }>();
  for (let r = headerRow + 1; r < grid.length; r++) {
    const code = s(grid[r]?.[base]);
    if (!code) break; // block ends at the first blank code
    if (/^(total|closed|incl)/i.test(code)) break;
    const name = s(grid[r]?.[base + 1]) || code;
    const raw = numOrNull(grid[r]?.[base + 2]);
    out.set(code, { name, cents: raw === null ? null : dollarsToCents(raw.toString()) });
  }
  return out;
}

export function parseCtcWorkbookBuffer(buf: Buffer): ParsedCtcWorkbook {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const warnings: string[] = [];
  if (!sheet) return { rows: [], variations: [], warnings: ["No worksheet found."] };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true });

  const curTitle = findCell(grid, "Current Costs to Date");
  const estTitle = findCell(grid, "Estimate Schedule");
  if (!curTitle && !estTitle) {
    return { rows: [], variations: [], warnings: ["Not a Cost to Complete Workings file (no Current Costs / Estimate Schedule blocks)."] };
  }

  // Header row holds "Code" cells; data starts the row after.
  const headerRow = (curTitle?.r ?? estTitle!.r) + 1;
  const current = curTitle ? readBlock(grid, headerRow, curTitle.c) : new Map();
  const estimate = estTitle ? readBlock(grid, headerRow, estTitle.c) : new Map();

  const codes = new Set<string>([...current.keys(), ...estimate.keys()]);
  const rows: ParsedCostRow[] = [...codes].map((code) => ({
    code,
    name: estimate.get(code)?.name ?? current.get(code)?.name ?? code,
    estimateCents: estimate.has(code) ? estimate.get(code)!.cents : null,
    currentCents: current.has(code) ? current.get(code)!.cents : null,
  }));

  // Approved Variations block (Variation | Amount).
  const varTitle = findCell(grid, "Approved Variations");
  const variations: ParsedCtcVariation[] = [];
  if (varTitle) {
    const vHeader = varTitle.r + 1; // "Variation | Amount"
    for (let r = vHeader + 1; r < grid.length; r++) {
      const title = s(grid[r]?.[varTitle.c]);
      if (!title) break;
      if (/^(approved variations total|total approved|incl)/i.test(title)) break;
      const amt = numOrNull(grid[r]?.[varTitle.c + 1]);
      variations.push({ title, amountCents: amt === null ? null : dollarsToCents(amt.toString()) });
    }
  }

  if (rows.length === 0) warnings.push("No cost-code rows found in the workbook.");
  return { rows, variations, warnings };
}
