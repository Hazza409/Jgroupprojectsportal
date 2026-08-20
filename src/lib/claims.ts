import { ClaimStatus } from "@prisma/client";
import { db } from "./db";
import { inclMarginGst, sumCents, centsToNumber } from "./money";
import { correctCostName } from "./houseStyle";

// ─────────────────────────────────────────────────────────────
// Cost-code name matching. Real-world estimate vs reconciliation
// sheets drift: "Fire Places" vs "Fireplaces", "P.C items" vs
// "P.C.Items", "Tool and Plant Hire" vs "Tools and Plant Hire",
// typos like "Balustarde" vs "Balustrade". Matching is two-tier:
//   1. exact on a normalized form (case/space/punctuation-proof)
//   2. unique near-match (edit distance ≤ 2) for plurals/typos
// Tier 2 only accepts an UNAMBIGUOUS best candidate.
// ─────────────────────────────────────────────────────────────

/** Lowercase and strip everything but letters/digits ("&" → "and"). */
export function normalizeCostName(s: string): string {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

/** Iterative Levenshtein distance (two-row DP). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1, // deletion
        cur[j - 1] + 1, // insertion
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), // substitution
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export interface CodeRef {
  id: string;
  name: string;
}

/** Match a claim-line description to a cost code, or null. Pass codes sorted by code for determinism. */
export function matchCostCodeId(description: string, codes: CodeRef[]): string | null {
  const target = normalizeCostName(description);
  if (!target) return null;

  // Tier 1: exact normalized match.
  for (const c of codes) if (normalizeCostName(c.name) === target) return c.id;

  // Tier 2: unique near match — only for names long enough that a distance of
  // 2 can't be a coincidence, and only when exactly one code is the best fit.
  // Names whose DIGITS differ never fuzzy-match ("Stage 2" must not match
  // "Stage 1" at distance 1 — that posts money to the wrong stage).
  if (target.length < 6) return null;
  const digits = (s: string) => s.replace(/[^0-9]/g, "");
  const maxD = target.length < 10 ? 1 : 2;
  let best: CodeRef | null = null;
  let bestD = maxD + 1;
  let ties = 0;
  for (const c of codes) {
    const norm = normalizeCostName(c.name);
    if (digits(norm) !== digits(target)) continue;
    // On short names a SAME-LENGTH single-char change is a different trade
    // ("Piling"/"Tiling", "Screens"/"Screeds") — not a plural. Only accept a
    // near-match that changes length (plural/appended char) for short names.
    if (target.length < 10 && norm.length === target.length) continue;
    const d = editDistance(target, norm);
    if (d < bestD) {
      best = c;
      bestD = d;
      ties = 1;
    } else if (d === bestD && best) {
      ties++;
    }
  }
  return best && ties === 1 ? best.id : null;
}

/**
 * A claim's client-facing headline amount (inc margin + GST):
 * recon-built claims store it (totalCents from the sheet); manual claims store
 * base-cost lines, so gross the line sum. EVERY page/email must use this — the
 * same figure everywhere (register, ledger, detail, print, overview).
 */
export function claimHeadlineCents(
  claim: { totalCents: number; lines: { claimedAmountCents: number }[] },
  company: { marginPercent: number; gstPercent: number },
): number {
  if (claim.totalCents > 0) return claim.totalCents;
  return inclMarginGst(sumCents(claim.lines.map((l) => l.claimedAmountCents)), company);
}

/** A project's cost codes in deterministic order, for matching. */
export async function projectCodeRefs(projectId: string): Promise<CodeRef[]> {
  return db.costCode.findMany({
    where: { projectId },
    orderBy: { code: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * Attach cost codes to any of a claim's still-unlinked lines using the fuzzy
 * matcher. Returns how many lines were re-linked.
 */
async function relinkClaimLines(claimId: string, codes: CodeRef[]): Promise<number> {
  const lines = await db.claimLineItem.findMany({
    where: { claimId, costCodeId: null },
    select: { id: true, description: true },
  });
  let n = 0;
  for (const l of lines) {
    const costCodeId = matchCostCodeId(l.description, codes);
    if (costCodeId) {
      await db.claimLineItem.update({ where: { id: l.id }, data: { costCodeId } });
      n++;
    }
  }
  return n;
}

/**
 * Post an APPROVED claim's line amounts into the cost feed (CostActual) so
 * Cost to Complete's "Current to Date" reflects approved claims. Lines are
 * re-linked to cost codes first; lines that still match nothing are posted
 * with costCodeId null and surface as "Unallocated" on the CTC page — money
 * never silently disappears. Idempotent: rows are keyed
 * `claim:<claimId>:<lineId>` (unique per project) and UPSERTED, so re-running
 * updates linkage/amounts and never double-counts.
 */
export async function materializeClaimActuals(projectId: string, claimId: string): Promise<number> {
  const claim = await db.progressClaim.findFirst({
    where: { id: claimId, projectId, status: ClaimStatus.APPROVED },
    select: { id: true, claimNumber: true, approvedAt: true, labourCents: true, costsCents: true },
  });
  if (!claim) return 0;

  const codes = await projectCodeRefs(projectId);
  await relinkClaimLines(claimId, codes);

  const lines = await db.claimLineItem.findMany({
    where: { claimId, claimedAmountCents: { not: 0 } },
    select: { id: true, description: true, costCodeId: true, claimedAmountCents: true },
  });
  const occurredAt = claim.approvedAt ?? new Date();
  for (const l of lines) {
    const xeroSourceId = `claim:${claim.id}:${l.id}`;
    await db.costActual.upsert({
      where: { projectId_xeroSourceId: { projectId, xeroSourceId } },
      create: {
        projectId,
        costCodeId: l.costCodeId,
        xeroSourceId,
        description: `Claim #${claim.claimNumber} — ${l.description}`,
        amountCents: l.claimedAmountCents,
        occurredAt,
      },
      // Keep linkage + amount in sync if the line was re-linked or corrected.
      update: { costCodeId: l.costCodeId, amountCents: l.claimedAmountCents },
    });
  }

  // J Group's recon sheets carry the builder's own labour as a SUMMARY figure,
  // not a budget-overview line — without this it never reaches Cost to
  // Complete (the "Labour" cost code stays $0 while the drawdown includes it).
  // Post it as its own actual, keyed claim:<id>:labour — but only when no line
  // already maps to the Labour code (then the sheet covered labour itself).
  const labourCode = codes.find((c) => normalizeCostName(c.name) === "labour") ?? null;
  const labourCoveredByLines = labourCode ? lines.some((l) => l.costCodeId === labourCode.id) : false;
  if (claim.labourCents !== 0 && !labourCoveredByLines) {
    const xeroSourceId = `claim:${claim.id}:labour`;
    await db.costActual.upsert({
      where: { projectId_xeroSourceId: { projectId, xeroSourceId } },
      create: {
        projectId,
        costCodeId: labourCode?.id ?? null,
        xeroSourceId,
        description: `Claim #${claim.claimNumber} — Labour`,
        amountCents: claim.labourCents,
        occurredAt,
      },
      update: { costCodeId: labourCode?.id ?? null, amountCents: claim.labourCents },
    });
  }

  // The recon sheet's SUMMARY is authoritative — the same rule Cost to Complete
  // already applies to variations ("park the difference so the column always
  // sums to the total").
  //
  // It matters because importReconSheet only creates line items when it finds a
  // budget-overview section. When that section doesn't parse, the claim still
  // stores its labour/costs summary but has NO lines, so approving it posted
  // labour and nothing else — Current to Date silently under-read by the whole
  // supplier/subcontract spend while the claim drew down the budget in full.
  // That's the "claims aren't talking to Cost to Complete" gap.
  //
  // Park whatever the lines don't account for against no cost code, where the
  // CTC already shows it as Unallocated. Base figures only: labour and costs are
  // stored ex-margin/ex-GST, and CTC grosses them up once on the way out.
  //
  // ONE DIRECTION ONLY: park a shortfall, never a negative. The summary and the
  // line items come from two INDEPENDENT sections of the sheet (supplier totals
  // vs budget overview), so either can fail to parse on its own. If the supplier
  // total is the half that's missing, costsCents reads 0 while the lines are
  // perfectly good — and a signed remainder would post a negative that cancels
  // those lines and leaves the claim contributing almost nothing. That is worse
  // than the bug this is here to fix. When the lines already meet or exceed the
  // summary, trust the lines and park nothing.
  const summaryBase = claim.labourCents + claim.costsCents;
  if (summaryBase > 0) {
    const postedBase =
      sumCents(lines.map((l) => l.claimedAmountCents)) +
      (claim.labourCents !== 0 && !labourCoveredByLines ? claim.labourCents : 0);
    const remainder = summaryBase - postedBase;
    const xeroSourceId = `claim:${claim.id}:remainder`;
    if (remainder > 0) {
      await db.costActual.upsert({
        where: { projectId_xeroSourceId: { projectId, xeroSourceId } },
        create: {
          projectId,
          costCodeId: null,
          xeroSourceId,
          description: `Claim #${claim.claimNumber} — not itemised by cost code`,
          amountCents: remainder,
          occurredAt,
        },
        update: { amountCents: remainder },
      });
    } else {
      // Re-running after a corrected sheet must clear a previously parked
      // balance, or it would be counted twice.
      await db.costActual.deleteMany({ where: { projectId, xeroSourceId } });
    }
  }
  return lines.length;
}

// ─────────────────────────────────────────────────────────────
// Cost to Complete: per-cost-code Estimate + Variations + Current.
// One shared computation so the CTC page AND the Excel export show
// identical numbers. All *Cents values are client-facing (incl
// margin + GST). Per-row figures are grossed individually; totals
// are grossed from the aggregate base (single rounding) — so a total
// can differ from the naive sum of rows by at most a cent, exactly
// as the on-screen table has always behaved.
// ─────────────────────────────────────────────────────────────

export interface CtcRow {
  id: string;
  code: string;
  name: string;
  /**
   * What this code is now expected to FINISH at, grossed like every other
   * figure here. Null when nobody has forecast it — which is NOT the same as
   * forecasting zero, so the pages must treat null as "no view yet".
   * Published only: a staged forecast is builder-business until sign-off.
   */
  forecastCents: number | null;
  forecastNote: string | null;
  /** Forecast − approved budget. Positive = a movement above estimate. */
  forecastMovementCents: number | null;
  estimateCents: number;
  variationsCents: number;
  revisedCents: number;
  currentCents: number;
  varianceCents: number;
}

export interface CostToComplete {
  rows: CtcRow[];
  // Amounts with no matching cost code, kept visible so totals reconcile.
  unallocated: { estimateCents: number; variationsCents: number; currentCents: number };
  totals: {
    estimateCents: number;
    variationsCents: number;
    revisedCents: number;
    currentCents: number;
    costToCompleteCents: number;
  };
}

export async function computeCostToComplete(
  projectId: string,
  company: { marginPercent: number; gstPercent: number },
): Promise<CostToComplete> {
  const [costCodes, approvedVars, unallocatedActuals, unallocatedEstLines] = await Promise.all([
    db.costCode.findMany({
      where: { projectId },
      orderBy: { code: "asc" },
      include: {
        estimateLines: { select: { totalCents: true } },
        costActuals: { select: { amountCents: true } },
      },
      // forecastCents / forecastNote come along with the model fields.
    }),
    db.variation.findMany({
      where: { projectId, status: "APPROVED" },
      orderBy: { variationNumber: "asc" },
      select: { id: true, totalCents: true, costCodeId: true, lines: { select: { totalCents: true, costCodeId: true } } },
    }),
    db.costActual.findMany({ where: { projectId, costCodeId: null }, select: { amountCents: true } }),
    db.estimateLineItem.findMany({ where: { projectId, costCodeId: null }, select: { totalCents: true } }),
  ]);

  // Approved variations grouped by the cost code each LINE adds to (a VO can
  // span trades); a line with no code falls back to the variation's code; a
  // variation with no lines allocates its whole total by the variation code.
  const varBaseByCode = new Map<string, number>();
  let unallocatedVarBase = 0;
  const addVar = (code: string | null, cents: number) => {
    if (code) varBaseByCode.set(code, (varBaseByCode.get(code) ?? 0) + cents);
    else unallocatedVarBase += cents;
  };
  for (const v of approvedVars) {
    if (v.lines.length === 0) {
      addVar(v.costCodeId, v.totalCents);
      continue;
    }
    for (const l of v.lines) addVar(l.costCodeId ?? v.costCodeId, l.totalCents);
    // The variation's own total is authoritative (a recon/imported VO can have
    // a headline that doesn't equal its line sum). Park any difference in
    // Unallocated so the column ALWAYS sums to the total — no drifting cents.
    const lineSum = sumCents(v.lines.map((l) => l.totalCents));
    const remainder = v.totalCents - lineSum;
    if (remainder !== 0) unallocatedVarBase += remainder;
  }

  const rows: CtcRow[] = costCodes.map((cc) => {
    const estimateCents = inclMarginGst(sumCents(cc.estimateLines.map((l) => l.totalCents)), company);
    const variationsCents = inclMarginGst(varBaseByCode.get(cc.id) ?? 0, company);
    const currentCents = inclMarginGst(sumCents(cc.costActuals.map((a) => a.amountCents)), company);
    const revisedCents = estimateCents + variationsCents;
    // The stored forecast is a base figure like every other amount, so it is
    // grossed up here once — same treatment as estimate and variations.
    const forecastCents = cc.forecastCents === null ? null : inclMarginGst(cc.forecastCents, company);
    return {
      // Spelling corrected for display only (Jake §7) — the stored name is
      // untouched, so cost-code matching is unaffected.
      id: cc.id, code: cc.code, name: correctCostName(cc.name),
      forecastCents,
      forecastNote: cc.forecastNote,
      forecastMovementCents: forecastCents === null ? null : forecastCents - revisedCents,
      estimateCents, variationsCents, revisedCents, currentCents,
      varianceCents: revisedCents - currentCents,
    };
  });

  const unallocatedEstBase = sumCents(unallocatedEstLines.map((l) => l.totalCents));
  const unallocatedActualBase = sumCents(unallocatedActuals.map((a) => a.amountCents));

  const estimateTotal = inclMarginGst(
    sumCents(costCodes.flatMap((cc) => cc.estimateLines.map((l) => l.totalCents))) + unallocatedEstBase,
    company,
  );
  const variationsTotal = inclMarginGst(sumCents([...varBaseByCode.values()]) + unallocatedVarBase, company);
  const currentTotal = inclMarginGst(
    sumCents(costCodes.flatMap((cc) => cc.costActuals.map((a) => a.amountCents))) + unallocatedActualBase,
    company,
  );
  const revisedTotal = estimateTotal + variationsTotal;

  return {
    rows,
    unallocated: {
      estimateCents: inclMarginGst(unallocatedEstBase, company),
      variationsCents: inclMarginGst(unallocatedVarBase, company),
      currentCents: inclMarginGst(unallocatedActualBase, company),
    },
    totals: {
      estimateCents: estimateTotal,
      variationsCents: variationsTotal,
      revisedCents: revisedTotal,
      currentCents: currentTotal,
      costToCompleteCents: revisedTotal - currentTotal,
    },
  };
}

/** Why a code is listed — which determines how it must be described. */
export type AdjustmentBasis = "forecast" | "spend";

export interface OverrunSummary {
  /** Cost codes tracking above their approved budget, largest first. */
  rows: (CtcRow & { overCents: number; basis: AdjustmentBasis })[];
  count: number;
  totalOverCents: number;
  /** Whole-job position. Negative = the job overall is above its budget. */
  netCents: number;
  /**
   * True when individual codes are above but the job as a whole is still within
   * its approved budget — i.e. movement elsewhere currently offsets them. Worth
   * saying out loud: the banner reads as alarming when the job is actually fine.
   */
  absorbed: boolean;
  /** How many are listed on a forecast rather than on money already spent. */
  forecastCount: number;
}

/**
 * Which cost codes are tracking above their approved budget.
 *
 * A code qualifies on EITHER basis:
 *   · forecast — a published forecast for it finishes above the approved
 *     budget. This is the one that gives notice: it lists the movement while
 *     the line may be barely spent, which is the whole point of forecasting a
 *     movement rather than waiting for it to happen.
 *   · spend — money already spent has passed the approved budget, with no
 *     forecast published to explain it.
 *
 * A published forecast WINS over spend for the same code: once someone has
 * said what the line is expected to finish at, that is the better number, and
 * reporting the raw overspend beside it would double-count the same movement.
 *
 * Approved variations are already inside the budget, so approved extra work is
 * never listed. Shared by the Budget, Forecast Adjustments, Cost to Complete
 * and Overview pages so all four report the same thing.
 */
export function overrunSummary(ctc: CostToComplete): OverrunSummary {
  const rows = ctc.rows
    .map((r) =>
      r.forecastMovementCents !== null
        ? { ...r, overCents: r.forecastMovementCents, basis: "forecast" as AdjustmentBasis }
        : { ...r, overCents: -r.varianceCents, basis: "spend" as AdjustmentBasis },
    )
    .filter((r) => r.overCents > 0)
    .sort((a, b) => b.overCents - a.overCents);
  const totalOverCents = rows.reduce((a, r) => a + r.overCents, 0);
  const netCents = ctc.totals.revisedCents - ctc.totals.currentCents;
  return {
    rows,
    count: rows.length,
    totalOverCents,
    netCents,
    absorbed: rows.length > 0 && netCents >= 0,
    forecastCount: rows.filter((r) => r.basis === "forecast").length,
  };
}

// ─────────────────────────────────────────────────────────────
// Invoice-on-invoice drawdown: each progress claim (invoice) draws
// down the contract budget (estimate + approved variations, client-
// facing incl margin+GST — same basis as the Overview). Cumulative
// counts APPROVED claims only, in claim-number order.
// ─────────────────────────────────────────────────────────────

export interface DrawdownRow {
  id: string;
  claimNumber: number;
  periodLabel: string | null;
  status: ClaimStatus;
  approvedAt: Date | null;
  /** This claim's headline amount (inc GST — matches the claims register). */
  amountCents: number;
  /** Cumulative drawn incl. this claim — null while not approved. */
  drawnToDateCents: number | null;
  /** Budget remaining after this claim — null while not approved. */
  remainingCents: number | null;
}

export interface ProjectDrawdown {
  budgetCents: number; // estimate + approved variations (incl margin+GST)
  drawnCents: number; // total of approved claims
  remainingCents: number;
  pct: number;
  rows: DrawdownRow[]; // ascending claim number
}

export async function projectDrawdown(
  projectId: string,
  company: { marginPercent: number; gstPercent: number },
): Promise<ProjectDrawdown> {
  const [ctc, claims] = await Promise.all([
    // ONE source of truth for the budget: the exact same computation the Cost
    // to Complete page uses. Previously this rounded separately and could
    // disagree with CTC by a cent — which a QS will circle in red (Jake §6).
    computeCostToComplete(projectId, company),
    db.progressClaim.findMany({
      where: { projectId },
      orderBy: { claimNumber: "asc" },
      include: { lines: { select: { claimedAmountCents: true } } },
    }),
  ]);

  const budgetCents = ctc.totals.revisedCents;

  let drawn = 0;
  const rows: DrawdownRow[] = claims.map((c) => {
    const amountCents = claimHeadlineCents(c, company);
    const counts = c.status === ClaimStatus.APPROVED;
    if (counts) drawn += amountCents;
    return {
      id: c.id,
      claimNumber: c.claimNumber,
      periodLabel: c.periodLabel,
      status: c.status,
      approvedAt: c.approvedAt,
      amountCents,
      drawnToDateCents: counts ? drawn : null,
      remainingCents: counts ? budgetCents - drawn : null,
    };
  });

  return {
    budgetCents,
    drawnCents: drawn,
    remainingCents: budgetCents - drawn,
    pct: budgetCents > 0 ? (drawn / budgetCents) * 100 : 0,
    rows,
  };
}

/**
 * Re-run linking + materialization for EVERY approved claim on a project.
 * Used by the builder-facing "Re-match cost codes" button after fixing names.
 */
export async function rematerializeProjectClaims(projectId: string): Promise<{ claims: number; lines: number }> {
  const claims = await db.progressClaim.findMany({
    where: { projectId, status: ClaimStatus.APPROVED },
    select: { id: true },
  });
  let lines = 0;
  for (const c of claims) lines += await materializeClaimActuals(projectId, c.id);
  return { claims: claims.length, lines };
}

// ─────────────────────────────────────────────────────────────
// The budget headline on a COST-PLUS job (Jake, Budget Revisions §2).
//
// The estimate is not a ceiling the client draws down against — they pay actual
// cost plus margin. So "Remaining" must count against the FORECAST final cost,
// not against the estimate; anchoring it to the estimate is what made the page
// read as a fixed pot being spent down.
//
// Where the forecast comes from: the project's published forecast final cost —
// a figure a person enters and Nick signs off, not something derived here. Until
// one is published we fall back to the approved budget, so the card always shows
// a real number and simply sharpens once a forecast exists. We deliberately do
// NOT compute a forecast from spend-to-date: an invented number in front of a
// client on a cost-plus job is worse than an honest placeholder.
// ─────────────────────────────────────────────────────────────
export interface BudgetPosition {
  estimateCents: number;
  variationsCents: number;
  /** Original estimate + approved variations. Not a cap. */
  approvedBudgetCents: number;
  forecastCents: number;
  /** False when forecastCents is standing in for an unpublished forecast. */
  forecastIsPublished: boolean;
  spentCents: number;
  /** Forecast − spent. Negative means spend has passed the forecast. */
  remainingToForecastCents: number;
  /** Spend as a % of FORECAST (Jake §2: the bar reads against forecast). */
  pctOfForecast: number;
}

/**
 * The arithmetic, separated from the fetch so it can be tested directly.
 *
 * @param publishedForecastCents a forecast that has cleared sign-off, or null.
 */
export function resolveBudgetPosition(
  publishedForecastCents: number | null,
  totals: { estimateCents: number; variationsCents: number; revisedCents: number; currentCents: number },
): BudgetPosition {
  const approvedBudgetCents = totals.revisedCents;
  const spentCents = totals.currentCents;
  const forecastCents = publishedForecastCents ?? approvedBudgetCents;
  return {
    estimateCents: totals.estimateCents,
    variationsCents: totals.variationsCents,
    approvedBudgetCents,
    forecastCents,
    forecastIsPublished: publishedForecastCents !== null,
    spentCents,
    remainingToForecastCents: forecastCents - spentCents,
    pctOfForecast: forecastCents > 0 ? (spentCents / forecastCents) * 100 : spentCents > 0 ? Infinity : 0,
  };
}

export async function budgetPosition(projectId: string, ctc: CostToComplete): Promise<BudgetPosition> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { forecastFinalCostCents: true, forecastUpdatedAt: true },
  });

  // Only a PUBLISHED forecast counts — a pending one hasn't cleared sign-off
  // and must not reach a client-facing figure.
  const published =
    project?.forecastFinalCostCents != null && project.forecastUpdatedAt != null
      ? centsToNumber(project.forecastFinalCostCents)
      : null;

  return resolveBudgetPosition(published, ctc.totals);
}

