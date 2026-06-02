import * as XLSX from "xlsx";
import { dollarsToCents } from "../money";

// ── Expected current-costs spreadsheet format ────────────────
//   Cost Code | Cost Item | Amount
// See /api/templates/current-costs. Lets a project import actual costs to date
// without a Xero connection.

export interface ParsedCurrentCost {
  code: string;
  name: string;
  amountCents: number;
}

const ALIASES = {
  code: ["cost code", "code", "account code"],
  name: ["cost item", "item", "description", "name"],
  amount: ["amount", "current", "cost", "spent", "actual"],
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

export function parseCurrentCostsBuffer(buf: Buffer): { rows: ParsedCurrentCost[]; warnings: string[] } {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], warnings: ["No worksheet found"] };

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  let headerRow = -1;
  const map: { code?: number; name?: number; amount?: number } = {};
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const cells = grid[r].map(norm);
    const code = cells.findIndex((c) => ALIASES.code.includes(c));
    const amount = cells.findIndex((c) => ALIASES.amount.includes(c));
    if (code >= 0 && amount >= 0) {
      map.code = code;
      map.amount = amount;
      map.name = cells.findIndex((c) => ALIASES.name.includes(c));
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) return { rows: [], warnings: ["Expected columns: Cost Code, Cost Item, Amount."] };

  const rows: ParsedCurrentCost[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r];
    const code = String(row[map.code!] ?? "").trim();
    if (!code) continue;
    rows.push({
      code,
      name: map.name! >= 0 ? String(row[map.name!] ?? "").trim() || code : code,
      amountCents: dollarsToCents(row[map.amount!] as string | number),
    });
  }
  return { rows, warnings: rows.length === 0 ? ["No data rows parsed."] : [] };
}
