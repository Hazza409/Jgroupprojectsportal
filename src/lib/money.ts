// Money is ALWAYS integer cents in the DB and across the app boundary.
// These helpers are the only sanctioned place to cross between cents and display.

// Margin + GST rates live in Company settings (src/lib/company.ts), not here —
// callers fetch the company and pass it in. Percent fields are whole numbers
// (12.5 means 12.5%).
export interface MarginGstRates {
  marginPercent: number;
  gstPercent: number;
}

/**
 * Gross a base (ex-margin, ex-GST) cents amount up to a client-facing figure
 * INCLUSIVE of builder's margin then GST. Single source of truth so every
 * costing across the app reads the same — no ambiguity. Accepts the Company
 * row directly (it satisfies MarginGstRates).
 */
export function inclMarginGst(baseCents: number, rates: MarginGstRates): number {
  return Math.round(baseCents * (1 + rates.marginPercent / 100) * (1 + rates.gstPercent / 100));
}

/**
 * Inverse of inclMarginGst: a client-facing amount back to base cents.
 *
 * Exists because people TYPE amounts in the same form they READ them — every
 * figure on the client pages is shown inc margin+GST, so an input interpreted
 * as base silently inflates by the combined rate the moment it's redisplayed
 * (~29.8% at 12.5% + 10%). Round-tripping incl(ex(x)) is exact to the cent for
 * ordinary figures; a boundary value may drift by one cent, never more.
 */
export function exMarginGst(inclCents: number, rates: MarginGstRates): number {
  return Math.round(inclCents / (1 + rates.marginPercent / 100) / (1 + rates.gstPercent / 100));
}

/** Parse a user/Excel-entered dollar string or number into integer cents.
 *  Accounting-style parentheses negatives — "(1,234.56)" — parse as negative. */
export function dollarsToCents(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0;
  let n: number;
  if (typeof input === "number") {
    n = input;
  } else {
    let s = String(input).replace(/[$,\s]/g, "");
    const parens = /^\((.*)\)$/.exec(s);
    if (parens) s = `-${parens[1]}`;
    n = Number(s);
  }
  if (!Number.isFinite(n)) return 0;
  // Round to nearest cent to avoid float drift (e.g. 0.1 + 0.2 issues).
  return Math.round(n * 100);
}

/** Integer cents → display string, e.g. 1234567 → "$12,345.67". */
export function formatCents(cents: number | bigint, opts: { currency?: string } = {}): string {
  const { currency = "AUD" } = opts;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
  }).format(centsToNumber(cents) / 100);
}

/**
 * Normalise a cents value to a JS number.
 *
 * Whole-project money (contract value, forecast final cost) is stored as BIGINT
 * because a $21,474,836.47 job overflows a 32-bit column — real jobs here are
 * larger than that. Postgres hands those back as JS BigInt, which can't be used
 * in arithmetic with numbers or passed to a client component, so convert at the
 * boundary. Number is safe to 2^53 cents (~$90 trillion).
 */
export function centsToNumber(v: number | bigint | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "bigint" ? Number(v) : v;
}

/** Sum a list of cent amounts safely (stays integer). */
export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + Math.trunc(v), 0);
}

/** quantity (may be fractional) × unitCostCents → integer cents line total. */
export function lineTotalCents(quantity: number, unitCostCents: number): number {
  return Math.round(quantity * unitCostCents);
}

/**
 * Largest value a 32-bit integer column can hold, in cents ($21,474,836.47).
 *
 * Whole-project money (contract value, forecast final cost) is BIGINT and has
 * no practical ceiling. Per-line amounts — estimate lines, claim lines,
 * variation lines, cost actuals — are still INT4, which is ample for a single
 * line but not for a whole job. Validate against this before writing so an
 * oversized figure produces a clear message instead of a driver error.
 */
export const INT4_MAX_CENTS = 2_147_483_647;

/** True when a cents value is too large for a 32-bit column. */
export function exceedsInt4(cents: number): boolean {
  return Math.abs(cents) > INT4_MAX_CENTS;
}

/** Standard message for an amount that won't fit a per-line column. */
export function tooLargeMessage(label = "That amount"): string {
  return `${label} is above the ${formatCents(INT4_MAX_CENTS)} limit for a single line. Split it across lines, or record it as the project's contract value.`;
}
