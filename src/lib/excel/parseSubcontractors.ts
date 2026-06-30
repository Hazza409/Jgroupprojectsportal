import * as XLSX from "xlsx";

// ── Expected subcontractor spreadsheet format ────────────────
// First worksheet, header row anywhere in the first 10 rows. Recognised headers
// (case-insensitive, flexible): Trade | Company | Contact | Phone | Email.
// One subcontractor per row. A row needs at least a Company or a Contact name.

export interface ParsedSubcontractor {
  trade: string | null;
  company: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
}

export interface ParsedSubcontractors {
  rows: ParsedSubcontractor[];
  warnings: string[];
}

type ColumnKey = "trade" | "company" | "contactName" | "phone" | "email";

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  trade: ["trade", "type", "category", "discipline", "scope", "works"],
  company: ["company", "business", "subcontractor", "subbie", "contractor", "firm", "company name", "business name"],
  contactName: ["contact", "contact name", "name", "person", "contact person"],
  phone: ["phone", "mobile", "tel", "telephone", "contact number", "number", "ph"],
  email: ["email", "e-mail", "email address"],
};

function normalise(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function findHeader(rows: unknown[][]): { headerRow: number; map: Partial<Record<ColumnKey, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = rows[r].map(normalise);
    const map: Partial<Record<ColumnKey, number>> = {};
    (Object.keys(HEADER_ALIASES) as ColumnKey[]).forEach((key) => {
      const idx = cells.findIndex((c) => HEADER_ALIASES[key].includes(c));
      if (idx >= 0) map[key] = idx;
    });
    // A header row needs a way to name the subcontractor (company or contact).
    if (map.company !== undefined || map.contactName !== undefined) return { headerRow: r, map };
  }
  return null;
}

export function parseSubcontractorsBuffer(buf: Buffer): ParsedSubcontractors {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], warnings: ["No worksheet found"] };

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const found = findHeader(rows);
  if (!found) {
    return {
      rows: [],
      warnings: ["Could not find a header row. Expected columns like: Trade, Company, Contact, Phone, Email."],
    };
  }

  const { headerRow, map } = found;
  const out: ParsedSubcontractor[] = [];
  const warnings: string[] = [];

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const str = (idx?: number) => {
      if (idx === undefined) return null;
      const v = row[idx];
      const s = v === undefined || v === null ? "" : String(v).trim();
      return s || null;
    };
    const company = str(map.company);
    const contactName = str(map.contactName);
    const trade = str(map.trade);
    const phone = str(map.phone);
    const email = str(map.email);

    if (!company && !contactName && !trade && !phone && !email) continue; // blank row
    if (!company && !contactName) {
      warnings.push(`Row ${r + 1}: skipped — needs a company or contact name.`);
      continue;
    }
    out.push({ trade, company, contactName, phone, email });
  }

  if (out.length === 0) warnings.push("Header found but no subcontractor rows parsed.");
  return { rows: out, warnings };
}
