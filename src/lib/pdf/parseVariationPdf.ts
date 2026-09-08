import { extractText, getDocumentProxy } from "unpdf";
import { VariationStatus } from "@prisma/client";
import { dollarsToCents } from "../money";

// ── J Group variation PDF ─────────────────────────────────────
// The client-facing variation document, one per file:
//
//   Customer name: David & Anna Duckworth
//   Variation No: V-01025
//   Job: J-01022 8 Bower Street Manly
//   Date: Oct 10th, 2025
//   <title line>
//   Variation items
//   # Description Qty UOM Cost (ex.) Total (ex.)
//   1 Supply and Install of Skylights 1.00 qty $83,857.50 $83,857.50
//   2 Original budget (Taken off) -1.00 qty $27,607.50 -$27,607.50
//   Subtotal: $56,250.00
//   GST: $5,625.00
//   Total: $61,875.00
//   Variation Notes
//   <notes>
//
// MONEY BASIS — the one thing to get right. "Cost (ex.)" on this document is
// ex-GST but ALREADY INCLUDES builder's margin: subtotal $56,250 → $50,000
// base at 12.5%, and $50,000 grossed back through margin + GST is the $61,875
// the client signs for. The dashboard stores BASE amounts everywhere and
// grosses at display time, so every figure here is divided by (1 + margin) on
// the way in. Skipping that inflates the variation by the margin twice.

export interface ParsedPdfVariationLine {
  description: string;
  quantity: number;
  unit: string | null;
  /** Base, ex margin and ex GST. */
  unitCostCents: number;
  totalCents: number;
}

export interface ParsedPdfVariation {
  /** Numeric part of "V-01025" — the number the client knows it by. */
  number: number | null;
  /** As printed, e.g. "V-01025". */
  reference: string | null;
  title: string;
  customerName: string | null;
  jobRef: string | null;
  /** Date on the document. */
  date: Date | null;
  notes: string | null;
  lines: ParsedPdfVariationLine[];
  /** Base total, ex margin and ex GST (the sum of the lines). */
  totalCents: number;
  /** Exactly as printed, for cross-checking: ex-GST inc margin, and the gross. */
  printedSubtotalCents: number | null;
  printedTotalCents: number | null;
  status: VariationStatus;
  warnings: string[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const money = (s: string) => dollarsToCents(s.replace(/[$,\s]/g, ""));

/** "Oct 10th, 2025", "May 4th, 2026" or "22 August 2025" → Date. */
function parseDocDate(raw: string): Date | null {
  // Month-first ("Oct 10th, 2025") and day-first ("22 August 2025") are both
  // in use across the templates; neither order is ambiguous because the month
  // is spelled out.
  const monthFirst = /([A-Za-z]{3,})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(raw);
  const dayFirst = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\s+(\d{4})/.exec(raw);
  const parts = monthFirst
    ? { monthWord: monthFirst[1], day: monthFirst[2], year: monthFirst[3] }
    : dayFirst
      ? { monthWord: dayFirst[2], day: dayFirst[1], year: dayFirst[3] }
      : null;
  if (!parts) return null;
  const month = MONTHS.findIndex((x) => parts.monthWord.toLowerCase().startsWith(x));
  if (month < 0) return null;
  const d = new Date(Number(parts.year), month, Number(parts.day));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Money as these documents write it, including accounting negatives:
 * "($1,246,157.55)" is a CREDIT. Read as a positive it silently inflates a
 * variation by twice the credit — on one of these that is $1.2m.
 */
function docMoney(raw: string): number {
  const negative = /^\s*\(.*\)\s*$/.test(raw);
  const n = dollarsToCents(raw.replace(/[()$,\s]/g, ""));
  return negative ? -n : n;
}

/**
 * Strip a base amount out of a figure that already carries builder's margin.
 * Rounds to the cent; the caller cross-checks the reassembled total.
 */
function deMargin(cents: number, marginPercent: number): number {
  return Math.round(cents / (1 + marginPercent / 100));
}

/**
 * The "CONTRACT VARIATION" template:
 *
 *   J GROUP PROJECTS
 *   CONTRACT VARIATION
 *   Variation No: VO 1015    Project: 394 Wyong Road, Duffys Forest
 *   Date: 22 August 2025     Job No: J-01024
 *   Status: Approved         Client: Katharine Davis-Rice
 *   REVISED Entry Front Door
 *   Includes blackened steel surrounding door/window frames…
 *   Description Qty UOM Amount (ex GST)
 *   Supply and Install Entry Front Door (includes frame/glazing) 1 qty $45,000.00
 *   Subtotal (ex GST) $45,000.00
 *   GST (10%) $4,500.00
 *   TOTAL (inc GST) $49,500.00
 *
 * Unlike the older layout this one PRINTS its approval status, so the builder
 * doesn't have to tell us which are live — the document already says.
 *
 * "Amount (ex GST)" is ex-GST but already carries builder's margin, the same
 * basis as the older template, so it is de-margined on the way in.
 */
function parseContractVariation(
  text: string,
  fileName: string,
  marginPercent: number,
  warnings: string[],
): ParsedPdfVariation {
  const grab = (re: RegExp) => re.exec(text)?.[1]?.trim() ?? null;

  const reference = grab(/Variation No:\s*([A-Za-z]*\s*\d+)/i)?.replace(/\s+/g, " ") ?? null;
  const number = reference ? Number(reference.replace(/[^0-9]/g, "")) || null : null;
  const customerName = grab(/Client:\s*(.+)/i);
  const jobRef = grab(/Job No:\s*(\S+)/i);
  const date = parseDocDate(grab(/Date:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i) ?? "");

  // "Status: Approved   Client: …" — take only what precedes the next label.
  const statusText = grab(/Status:\s*(.+?)(?:\s{2,}|\s+Client:|\n)/i) ?? "";
  const approved = /^approved\b/i.test(statusText);
  if (!approved && statusText) {
    warnings.push(`${fileName}: document states status "${statusText}" — imported as a draft.`);
  }

  // Title is the line after the Status/Client row; anything further before the
  // table header is scope detail.
  const head = grab(/Client:[^\n]*\n([\s\S]*?)\n\s*Description\s+Qty/i) ?? "";
  const headLines = head.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = headLines[0] ?? fileName.replace(/\.pdf$/i, "");
  const notes = headLines.slice(1).join(" ").replace(/\s+/g, " ").trim() || null;

  const money = (s: string) => dollarsToCents(s.replace(/[$,\s]/g, ""));
  const printedSubtotalCents = (() => {
    const v = grab(/Subtotal \(ex GST\)\s*\$?(-?[\d,]+\.\d{2})/i);
    return v === null ? null : money(v);
  })();
  const printedTotalCents = (() => {
    const v = grab(/TOTAL \(inc GST\)\s*\$?(-?[\d,]+\.\d{2})/i);
    return v === null ? null : money(v);
  })();

  // Rows end with "<qty> <uom> $<amount>". The description may sit on the same
  // line, or — where the document carries a scope paragraph — on the lines
  // ABOVE it, with the amount line holding nothing else. Text is therefore
  // accumulated until an amount closes a row, rather than assuming one line
  // per item.
  const block = /Description\s+Qty\s+UOM\s+Amount \(ex GST\)([\s\S]*?)Subtotal \(ex GST\)/i.exec(text)?.[1] ?? "";
  const lines: ParsedPdfVariationLine[] = [];
  const row = /^(.*?)\s*(-?[\d.]+)\s+([A-Za-z][A-Za-z0-9./]*)\s+(\(?\s*-?\$?[\d,]+\.\d{2}\s*\)?)$/;
  let pending: string[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = row.exec(line);
    if (!m) {
      pending.push(line);
      continue;
    }
    const description = [...pending, m[1]].join(" ").replace(/\s+/g, " ").trim();
    pending = [];
    const qty = Number(m[2]);
    const q = Number.isFinite(qty) && qty !== 0 ? qty : 1;
    const gross = docMoney(m[4]);
    if (!description) continue;
    lines.push({
      description,
      quantity: q,
      unit: m[3] || null,
      unitCostCents: deMargin(Math.round(gross / q), marginPercent),
      totalCents: deMargin(gross, marginPercent),
    });
  }

  if (lines.length === 0) warnings.push(`${fileName}: no variation line items could be read.`);

  const totalCents = lines.reduce((a, l) => a + l.totalCents, 0);
  if (printedSubtotalCents !== null && lines.length > 0) {
    const regrossed = Math.round(totalCents * (1 + marginPercent / 100));
    if (Math.abs(regrossed - printedSubtotalCents) > 100) {
      warnings.push(
        `${fileName}: line items come to $${(regrossed / 100).toFixed(2)} once builder's margin is added ` +
          `back, but the document says $${(printedSubtotalCents / 100).toFixed(2)}.`,
      );
    }
  }

  return {
    number,
    reference,
    title,
    customerName,
    jobRef,
    date,
    notes,
    lines,
    totalCents,
    printedSubtotalCents,
    printedTotalCents,
    status: approved ? VariationStatus.APPROVED : VariationStatus.DRAFT,
    warnings,
  };
}

export async function parseVariationPdfBuffer(
  buf: Buffer,
  fileName: string,
  marginPercent = 12.5,
): Promise<ParsedPdfVariation> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  const warnings: string[] = [];

  // Two variation templates are in use. The "CONTRACT VARIATION" one states
  // its own approval status on the page, which the older one does not, so it
  // is worth recognising rather than forcing into the same shape.
  if (/CONTRACT VARIATION/i.test(text)) {
    return parseContractVariation(text, fileName, marginPercent, warnings);
  }

  const grab = (re: RegExp) => re.exec(text)?.[1]?.trim() ?? null;

  const reference = grab(/Variation No:\s*(\S+)/i);
  // The numeric part is the identifier the client knows and the document is
  // filed under. Preserving it matters: renumbering a signed V-01025 to "#1"
  // breaks the link between the portal and the paperwork.
  const number = reference ? Number(reference.replace(/[^0-9]/g, "")) || null : null;
  const customerName = grab(/Customer name:\s*([\s\S]*?)\s*Variation No:/i)?.replace(/\s+/g, " ") ?? null;
  const jobRef = grab(/Job:\s*(.+)/i);
  const dateRaw = grab(/Date:\s*(.+)/i);
  const date = dateRaw ? parseDocDate(dateRaw) : null;

  // Title: the line between the Date line and the "Variation items" heading.
  // The template labels it inconsistently ("Place Holder:", "PLACEHOLDER:",
  // or nothing at all), so the label is stripped rather than relied upon.
  let title =
    grab(/Date:\s*[^\n]*\n([\s\S]*?)\n\s*Variation items/i)?.replace(/\s+/g, " ").trim() ?? "";
  title = title.replace(/^(place\s*holder|placeholder)\s*[:\-]\s*/i, "").trim();

  const notes =
    grab(/Variation Notes\s*([\s\S]*?)(?:\n\s*Variation\s*\n|J Group Projects|Customer Approval)/i)
      ?.replace(/\s+/g, " ")
      .trim() || null;

  const printedSubtotalCents = (() => {
    const v = grab(/Subtotal:\s*\$?(-?[\d,]+\.\d{2})/i);
    return v === null ? null : money(v);
  })();
  const printedTotalCents = (() => {
    const v = grab(/\bTotal:\s*\$?(-?[\d,]+\.\d{2})/i);
    return v === null ? null : money(v);
  })();

  // ── line items
  //
  // Two table layouts are in circulation. The usual one is five columns:
  //   # Description Qty UOM Cost (ex.) Total (ex.)
  // and some documents use a three-column form with no quantity, whose rows
  // carry indented multi-line "Note:" scope beneath them:
  //   # Description Total (ex.)
  const block = /Variation items([\s\S]*?)Subtotal:/i.exec(text)?.[1] ?? "";
  const header = /#\s*Description([\s\S]*?)Total\s*\(ex\.?\)/i.exec(block);
  const hasQtyColumns = /qty/i.test(header?.[1] ?? "");
  const body = header ? block.replace(header[0], "") : block;

  const lines: ParsedPdfVariationLine[] = [];

  if (hasQtyColumns) {
    // Each row ends with: qty  unit  $cost  $total. Descriptions wrap across
    // lines, so rows are found by their numeric tail and the description is
    // whatever precedes it.
    const tail = /(-?\d+(?:\.\d+)?)\s+([A-Za-z][A-Za-z0-9./]*)\s+(-?\$?-?[\d,]+\.\d{2})\s+(-?\$?-?[\d,]+\.\d{2})/g;
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = tail.exec(body)) !== null) {
      const description = body
        .slice(cursor, m.index)
        .replace(/\s+/g, " ")
        .replace(/^\s*\d+\s+/, "") // drop the row index
        .trim();
      cursor = m.index + m[0].length;
      const quantity = Number(m[1]);
      if (!description) continue;
      lines.push({
        description,
        quantity: Number.isFinite(quantity) ? quantity : 1,
        unit: m[2] || null,
        unitCostCents: deMargin(money(m[3]), marginPercent),
        totalCents: deMargin(money(m[4]), marginPercent),
      });
    }
  } else {
    // Three-column form: a row begins with its index and ends with the amount;
    // everything until the next indexed row is that row's scope detail.
    const rows: { parts: string[]; amount: string }[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const start = /^(\d+)\s+(.*?)\s+(-?\$?-?[\d,]+\.\d{2})$/.exec(line);
      if (start) {
        rows.push({ parts: [start[2].trim()], amount: start[3] });
      } else if (rows.length > 0) {
        rows[rows.length - 1].parts.push(line);
      }
    }
    for (const r of rows) {
      const description = r.parts.join(" ").replace(/\s+/g, " ").trim();
      if (!description) continue;
      const cents = deMargin(money(r.amount), marginPercent);
      lines.push({ description, quantity: 1, unit: null, unitCostCents: cents, totalCents: cents });
    }
  }

  if (lines.length === 0) {
    warnings.push(`${fileName}: no variation line items could be read.`);
  }
  if (!title) {
    title = reference ? `Variation ${reference}` : fileName.replace(/\.pdf$/i, "");
    warnings.push(`${fileName}: no title line found — using "${title}".`);
  }

  const totalCents = lines.reduce((a, l) => a + l.totalCents, 0);

  // Cross-check: the lines de-margined and re-grossed must land back on the
  // printed subtotal. A mismatch means the document isn't on the margin rate
  // we were given, and the amount would be wrong — so it's reported loudly
  // rather than imported quietly.
  if (printedSubtotalCents !== null) {
    const regrossed = Math.round(totalCents * (1 + marginPercent / 100));
    if (Math.abs(regrossed - printedSubtotalCents) > 100) {
      warnings.push(
        `${fileName}: line items come to $${(regrossed / 100).toFixed(2)} once builder's margin is added ` +
          `back, but the document says $${(printedSubtotalCents / 100).toFixed(2)}. Check the margin rate ` +
          `on this variation before relying on the figure.`,
      );
    }
  }

  return {
    number,
    reference,
    title,
    customerName,
    jobRef,
    date,
    notes,
    lines,
    totalCents,
    printedSubtotalCents,
    printedTotalCents,
    // Approval is never inferred from the document: the signature blocks on
    // these are blank even for variations the client has agreed to.
    status: VariationStatus.DRAFT,
    warnings,
  };
}
