import * as XLSX from "xlsx";
import { dollarsToCents } from "../money";

// ── Cost to Complete update sheet ────────────────────────────
//   Cost Code | Cost Item | Estimate | Current Cost to Date
// Estimate is optional (blank = leave the budget unchanged). Amounts are the
// ex-margin / ex-GST base — the app grosses up for display. See
// /api/templates/current-costs.

export interface ParsedCostRow {
  code: string;
  name: string;
  estimateCents: number | null; // null = not provided
  currentCents: number | null; // null = not provided
}

const ALIASES = {
  code: ["cost code", "code", "account code"],
  name: ["cost item", "item", "description", "name"],
  estimate: ["estimate", "estimate line", "budget", "estimate amount"],
  current: ["current cost to date", "current to date", "current", "amount", "cost", "spent", "actual"],
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function parseCostRowsBuffer(buf: Buffer): { rows: ParsedCostRow[]; warnings: string[] } {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], warnings: ["No worksheet found"] };

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  let headerRow = -1;
  const map: { code?: number; name?: number; estimate?: number; current?: number } = {};
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const cells = grid[r].map(norm);
    const code = cells.findIndex((c) => ALIASES.code.includes(c));
    const current = cells.findIndex((c) => ALIASES.current.includes(c));
    const estimate = cells.findIndex((c) => ALIASES.estimate.includes(c));
    if (code >= 0 && (current >= 0 || estimate >= 0)) {
      map.code = code;
      map.name = cells.findIndex((c) => ALIASES.name.includes(c));
      map.estimate = estimate;
      map.current = current;
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) return { rows: [], warnings: ["Expected columns: Cost Code, Cost Item, Estimate, Current Cost to Date."] };

  const rows: ParsedCostRow[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r];
    const code = String(row[map.code!] ?? "").trim();
    if (!code) continue;
    const est = map.estimate! >= 0 ? numOrNull(row[map.estimate!]) : null;
    const cur = map.current! >= 0 ? numOrNull(row[map.current!]) : null;
    rows.push({
      code,
      name: map.name! >= 0 ? String(row[map.name!] ?? "").trim() || code : code,
      estimateCents: est === null ? null : dollarsToCents(est.toString()),
      currentCents: cur === null ? null : dollarsToCents(cur.toString()),
    });
  }
  return { rows, warnings: rows.length === 0 ? ["No data rows parsed."] : [] };
}
