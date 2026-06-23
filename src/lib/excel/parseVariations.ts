import * as XLSX from "xlsx";
import { VariationStatus } from "@prisma/client";
import { dollarsToCents, lineTotalCents, sumCents } from "../money";

// ── Expected variation spreadsheet format ────────────────────
// First worksheet, header row anywhere in the first 10 rows. Recognised
// headers (case-insensitive, flexible):
//
//   VO # | Title | Description | Line Description | Qty | Unit | Unit Cost | Status
//
// Rows that share the same VO # (or, if no number, the same Title) are grouped
// into ONE variation with multiple line items. Money columns must be the BASE
// supplier cost — the app adds builder's margin + GST for the client at display
// time (inclMarginGst), so do NOT pre-gross the spreadsheet figures.

export interface ParsedVariationLine {
  description: string;
  quantity: number;
  unit: string | null;
  unitCostCents: number;
  totalCents: number;
}

export interface ParsedVariation {
  number: number | null; // VO # from the sheet (informational — the importer auto-numbers)
  title: string;
  description: string | null;
  status: VariationStatus;
  lines: ParsedVariationLine[];
  totalCents: number; // sum of line totals (base, ex-margin/ex-GST)
}

export interface ParsedVariations {
  variations: ParsedVariation[];
  warnings: string[];
}

type ColumnKey =
  | "number"
  | "title"
  | "description"
  | "lineDescription"
  | "quantity"
  | "unit"
  | "unitCost"
  | "status"
  | "total";

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  number: ["vo #", "vo#", "vo no", "vo number", "variation #", "variation no", "variation number", "no", "number"],
  title: ["title", "variation", "vo title", "variation title", "name"],
  description: ["description", "variation description", "details", "scope"],
  lineDescription: ["line description", "line item", "line", "item description", "item"],
  quantity: ["qty", "quantity", "qnty"],
  unit: ["unit", "uom", "units"],
  unitCost: ["unit cost", "rate", "unit price", "unitcost", "$/unit", "cost"],
  status: ["status", "state"],
  total: ["total", "amount", "line total", "subtotal", "total cost"],
};

function normalise(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function parseStatus(raw: unknown): VariationStatus {
  switch (normalise(raw)) {
    case "approved":
      return VariationStatus.APPROVED;
    case "submitted":
    case "for approval":
      return VariationStatus.SUBMITTED;
    case "rejected":
    case "declined":
      return VariationStatus.REJECTED;
    default:
      return VariationStatus.DRAFT; // blank/unknown → DRAFT (builder reviews before sending)
  }
}

/** Locate the header row + map each logical column to its index. */
function findHeader(rows: unknown[][]): { headerRow: number; map: Partial<Record<ColumnKey, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = rows[r].map(normalise);
    const map: Partial<Record<ColumnKey, number>> = {};
    (Object.keys(HEADER_ALIASES) as ColumnKey[]).forEach((key) => {
      const idx = cells.findIndex((c) => HEADER_ALIASES[key].includes(c));
      if (idx >= 0) map[key] = idx;
    });
    // Need a way to name a variation (title or description) + a money column.
    const hasName = map.title !== undefined || map.description !== undefined || map.lineDescription !== undefined;
    const hasMoney = map.unitCost !== undefined || map.total !== undefined;
    if (hasName && hasMoney) return { headerRow: r, map };
  }
  return null;
}

export function parseVariationsBuffer(buf: Buffer): ParsedVariations {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { variations: [], warnings: ["No worksheet found"] };

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const found = findHeader(rows);
  if (!found) {
    return {
      variations: [],
      warnings: [
        "Could not find a header row. Expected columns like: VO #, Title, Description, Line Description, Qty, Unit, Unit Cost, Status.",
      ],
    };
  }

  const { headerRow, map } = found;
  const warnings: string[] = [];
  // Preserve sheet order while grouping rows into variations.
  const order: string[] = [];
  const groups = new Map<string, ParsedVariation>();

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const cell = (idx?: number) => (idx === undefined ? undefined : row[idx]);

    const voRaw = cell(map.number);
    const voNum = voRaw === undefined || voRaw === "" ? null : Math.trunc(Number(voRaw)) || null;
    const title = String(cell(map.title) ?? "").trim();
    const desc = String(cell(map.description) ?? "").trim();
    const lineDesc = String(cell(map.lineDescription) ?? "").trim();
    const effectiveTitle = title || desc || lineDesc;

    const unitCostCents = dollarsToCents(cell(map.unitCost) as string | number);
    const sheetTotalCents = dollarsToCents(cell(map.total) as string | number);

    // Skip fully blank rows (no name and no money).
    if (!effectiveTitle && !unitCostCents && !sheetTotalCents) continue;
    if (!effectiveTitle) {
      warnings.push(`Row ${r + 1}: skipped — no title/description to name the variation.`);
      continue;
    }

    const quantity = Number(cell(map.quantity) ?? 1) || 1;
    const computed = lineTotalCents(quantity, unitCostCents);
    if (unitCostCents && sheetTotalCents && Math.abs(sheetTotalCents - computed) > 1) {
      warnings.push(`Row ${r + 1}: sheet total ${sheetTotalCents}c != qty×rate ${computed}c (using computed).`);
    }
    const lineTotal = unitCostCents ? computed : sheetTotalCents;

    const key = voNum != null ? `vo:${voNum}` : `t:${effectiveTitle.toLowerCase()}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        number: voNum,
        title: effectiveTitle,
        description: desc || null,
        status: parseStatus(cell(map.status)),
        lines: [],
        totalCents: 0,
      };
      groups.set(key, group);
      order.push(key);
    } else if (!group.description && desc) {
      group.description = desc; // fill description from a later row if the first lacked one
    }

    group.lines.push({
      description: lineDesc || title || desc || "Line item",
      quantity,
      unit: cell(map.unit) ? String(cell(map.unit)).trim() : null,
      unitCostCents,
      totalCents: lineTotal,
    });
  }

  const variations = order.map((key) => {
    const g = groups.get(key)!;
    g.totalCents = sumCents(g.lines.map((l) => l.totalCents));
    return g;
  });

  if (variations.length === 0) warnings.push("Header found but no variation rows parsed.");
  return { variations, warnings };
}
