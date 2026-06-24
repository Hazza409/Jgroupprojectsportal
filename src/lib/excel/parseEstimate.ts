import * as XLSX from "xlsx";
import { dollarsToCents, lineTotalCents } from "../money";

// ── Expected estimate spreadsheet format ─────────────────────
// First worksheet, header row anywhere in the first 10 rows. Recognised
// headers (case-insensitive, flexible):
//
//   Cost Code | Cost Code Description | Line Item Description | Qty | Unit | Cost per Quantity | Overall Cost
//
// "Cost Code Description" names the cost code (carried into Cost to Complete);
// "Line Item Description" is the individual line. Columns may be reordered.
// "Overall Cost" is recomputed from Qty × Cost per Quantity; the sheet value is
// only a validation cross-check (logged on mismatch). Older sheets with a plain
// "Description" column still work (treated as the line item description).

export interface ParsedEstimateLine {
  costCode: string | null;
  costCodeName: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unitCostCents: number;
  totalCents: number;
  sortOrder: number;
}

export interface ParsedEstimate {
  lines: ParsedEstimateLine[];
  warnings: string[];
}

const HEADER_ALIASES: Record<keyof ColumnMap, string[]> = {
  costCode: ["cost code", "code", "cost_code"],
  costCodeName: ["cost code description", "cost code name", "code description", "cost item", "cost description"],
  description: ["line item description", "line item", "line description", "description", "item", "scope", "trade"],
  quantity: ["qty", "quantity", "qnty"],
  unit: ["unit", "uom", "units"],
  unitCost: ["cost per quantity", "cost per qty", "unit cost", "rate", "unit price", "unitcost", "$/unit"],
  total: ["overall cost", "total", "amount", "line total", "subtotal", "total cost"],
};

interface ColumnMap {
  costCode: number;
  costCodeName: number;
  description: number;
  quantity: number;
  unit: number;
  unitCost: number;
  total: number;
}

function normalise(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

/** Locate the header row + map each logical column to its index. */
function findHeader(rows: unknown[][]): { headerRow: number; map: Partial<ColumnMap> } | null {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = rows[r].map(normalise);
    const map: Partial<ColumnMap> = {};
    (Object.keys(HEADER_ALIASES) as (keyof ColumnMap)[]).forEach((key) => {
      const idx = cells.findIndex((c) => HEADER_ALIASES[key].includes(c));
      if (idx >= 0) map[key] = idx;
    });
    // Need at least a description + a money column to call it the header.
    if (map.description !== undefined && (map.unitCost !== undefined || map.total !== undefined)) {
      return { headerRow: r, map };
    }
  }
  return null;
}

export function parseEstimateBuffer(buf: Buffer): ParsedEstimate {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { lines: [], warnings: ["No worksheet found"] };

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const found = findHeader(rows);
  if (!found) {
    return {
      lines: [],
      warnings: [
        "Could not find a header row. Expected columns like: Cost Code, Description, Qty, Unit, Unit Cost, Total.",
      ],
    };
  }

  const { headerRow, map } = found;
  const warnings: string[] = [];
  const lines: ParsedEstimateLine[] = [];

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const cell = (idx?: number) => (idx === undefined ? undefined : row[idx]);

    const description = String(cell(map.description) ?? "").trim();
    if (!description) continue; // skip blank/section-break rows

    const quantity = Number(cell(map.quantity) ?? 1) || 0;
    const unitCostCents = dollarsToCents(cell(map.unitCost) as string | number);
    const computed = lineTotalCents(quantity || 1, unitCostCents);
    const sheetTotalCents = dollarsToCents(cell(map.total) as string | number);

    // If sheet has a total but it disagrees with qty×rate by > 1c, flag it.
    if (sheetTotalCents && Math.abs(sheetTotalCents - computed) > 1) {
      warnings.push(
        `Row ${r + 1}: sheet total ${sheetTotalCents}c != qty×rate ${computed}c (using computed).`,
      );
    }

    lines.push({
      costCode: cell(map.costCode) ? String(cell(map.costCode)).trim() : null,
      costCodeName: cell(map.costCodeName) ? String(cell(map.costCodeName)).trim() : null,
      description,
      quantity: quantity || 1,
      unit: cell(map.unit) ? String(cell(map.unit)).trim() : null,
      unitCostCents,
      // Prefer computed; fall back to sheet total if no unit cost was provided.
      totalCents: unitCostCents ? computed : sheetTotalCents,
      sortOrder: lines.length,
    });
  }

  if (lines.length === 0) warnings.push("Header found but no data rows parsed.");
  return { lines, warnings };
}
