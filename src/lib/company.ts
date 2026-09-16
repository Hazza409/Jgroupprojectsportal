// Company (white-label + tenancy) settings.
// M1 introduced the Company row; M2 (SAAS-PLAN) made it the tenant anchor:
// users and projects carry companyId. Branding, margin base and approvers must
// be resolved for the RIGHT company. Three resolvers, by context:
//
//   getDefaultCompany()          — public pages ONLY (landing, login, manifest,
//                                  root layout, legal) where no tenant is known.
//                                  Today: the oldest company (J Group).
//                                  Host/subdomain→company routing is an M3 concern.
//   getCompanyForUser(userId)    — authed chrome (TopBar, builder pages,
//                                  settings). The user's own company.
//   getProjectCompany(projectId) — anything project-bound (branding on a project
//                                  page, claim print, emails). The project's company.
//   getProjectRates(projectId)   — getProjectCompany + this project's margin
//                                  override; authoritative for money figures.
//
// Never hardcode a company name, tagline, logo, margin, GST or approver list.

import { cache } from "react";
import type { Company } from "@prisma/client";
import { db } from "./db";

/**
 * The platform-default company, for public pages that have no tenant context.
 * Defensive: if the row is somehow missing (fresh DB that skipped the migration
 * seed), recreate it so the live J Group site can never render unbranded.
 */
export const getDefaultCompany = cache(async (): Promise<Company> => {
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

/** The company a user belongs to. Falls back to default if the row vanished mid-session. */
export const getCompanyForUser = cache(async (userId: string): Promise<Company> => {
  const user = await db.user.findUnique({ where: { id: userId }, select: { company: true } });
  return user?.company ?? getDefaultCompany();
});

/** The company that owns a project — authoritative for its branding + rate base. */
export const getProjectCompany = cache(async (projectId: string): Promise<Company> => {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { company: true } });
  return project?.company ?? getDefaultCompany();
});

/**
 * Company settings with THIS project's builder's margin applied.
 *
 * Margin is negotiated per contract — 8 Bower St is 12.5% while the portal
 * default is 12% — and grossing a job at the wrong rate misstates its contract
 * sum and everything derived from it. The base row is the PROJECT'S company
 * (M2), not an arbitrary one; the per-project margin override is layered on top.
 *
 * Shaped as a Company so it drops straight into inclMarginGst / exMarginGst /
 * moneyStructure / computeCostToComplete without changing their signatures.
 * GST is statutory, so it is never overridden per project.
 */
export const getProjectRates = cache(async (projectId: string): Promise<Company> => {
  const [company, project] = await Promise.all([
    getProjectCompany(projectId),
    db.project.findUnique({ where: { id: projectId }, select: { marginPercent: true } }),
  ]);
  const override = project?.marginPercent;
  if (override === null || override === undefined || !Number.isFinite(override)) return company;
  return { ...company, marginPercent: override };
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
