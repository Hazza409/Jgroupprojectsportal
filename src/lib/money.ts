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

/** Parse a user/Excel-entered dollar string or number into integer cents. */
export function dollarsToCents(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0;
  const n = typeof input === "number" ? input : Number(String(input).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  // Round to nearest cent to avoid float drift (e.g. 0.1 + 0.2 issues).
  return Math.round(n * 100);
}

/** Integer cents → display string, e.g. 1234567 → "$12,345.67". */
export function formatCents(cents: number, opts: { currency?: string } = {}): string {
  const { currency = "AUD" } = opts;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

/** Sum a list of cent amounts safely (stays integer). */
export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + Math.trunc(v), 0);
}

/** quantity (may be fractional) × unitCostCents → integer cents line total. */
export function lineTotalCents(quantity: number, unitCostCents: number): number {
  return Math.round(quantity * unitCostCents);
}
