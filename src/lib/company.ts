// Company (white-label) settings — SAAS-PLAN M1.
// ONE row today (seeded by the company_settings migration); becomes the
// per-tenant anchor in M2. All branding + commercial defaults must be read
// through getCompany() — never hardcode a name, tagline, logo, margin or GST
// rate anywhere in the app.

import { cache } from "react";
import type { Company } from "@prisma/client";
import { db } from "./db";

/**
 * The current company settings, memoised per request. Defensive: if the row
 * is somehow missing (fresh DB that skipped the migration seed), recreate it
 * with the same values the migration inserts, so the live J Group site can
 * never render unbranded. (Multi-company lookup arrives in M2.)
 */
export const getCompany = cache(async (): Promise<Company> => {
  const company = await db.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (company) return company;
  return db.company.create({
    data: {
      id: "company_jgroup",
      name: "J Group Projects",
      shortName: "J Group",
      tagline: "One Of One",
    },
  });
});

/** Short name for compact contexts (home-screen label, email subjects). */
export function companyShortName(company: Company): string {
  return company.shortName || company.name;
}

// ── Brand accent colours ─────────────────────────────────────
// The theme's accent is the --c-brand / --c-onbrand CSS variable pair
// (globals.css). When a company sets custom hex accents, the root layout
// injects overrides via brandColorCss(); when unset the monochrome default
// stands (J Group's look).

/** "#rrggbb" → "R G B" (the token format globals.css uses). Null on bad input. */
function hexToRgbTriple(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Ink or white text, whichever reads on the given accent. */
function onColorTriple(triple: string): string {
  const [r, g, b] = triple.split(" ").map(Number);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 140 ? "22 21 20" : "255 255 255";
}

/**
 * CSS overriding the theme accent when custom brand colours are set.
 * `html.dark` / `html.light` outrank the `.dark` / `.light` rules in
 * globals.css regardless of stylesheet order. Empty string when unset.
 */
export function brandColorCss(company: Company): string {
  let css = "";
  const dark = hexToRgbTriple(company.brandColorDark);
  if (dark) css += `html.dark{--c-brand:${dark};--c-onbrand:${onColorTriple(dark)};}`;
  const light = hexToRgbTriple(company.brandColorLight);
  if (light) css += `html.light{--c-brand:${light};--c-onbrand:${onColorTriple(light)};}`;
  return css;
}
