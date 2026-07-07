import { ClaimStatus } from "@prisma/client";
import { db } from "./db";

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
  if (target.length < 6) return null;
  let best: CodeRef | null = null;
  let bestD = 3; // accept distance ≤ 2
  let ties = 0;
  for (const c of codes) {
    const d = editDistance(target, normalizeCostName(c.name));
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
    select: { id: true, claimNumber: true, approvedAt: true },
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
  return lines.length;
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
