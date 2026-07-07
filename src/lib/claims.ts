import { ClaimStatus } from "@prisma/client";
import { db } from "./db";

/**
 * Post an APPROVED claim's per-cost-code amounts into the cost feed
 * (CostActual) so Cost to Complete's "Current to Date" reflects approved
 * claims. Called on approval (decideClaim); a data migration backfills claims
 * approved before this existed.
 *
 * Idempotent: rows are keyed `claim:<claimId>:<lineId>` against the
 * (projectId, xeroSourceId) unique constraint with skipDuplicates, so calling
 * it twice never double-counts. Only lines matched to a cost code flow through
 * — the CTC table is per-cost-code. Amounts are the claim's base "this period"
 * figures (ex margin/GST), the same basis as every other CostActual.
 */
export async function materializeClaimActuals(projectId: string, claimId: string): Promise<number> {
  const claim = await db.progressClaim.findFirst({
    where: { id: claimId, projectId, status: ClaimStatus.APPROVED },
    include: {
      lines: { where: { costCodeId: { not: null }, claimedAmountCents: { not: 0 } } },
    },
  });
  if (!claim || claim.lines.length === 0) return 0;

  const occurredAt = claim.approvedAt ?? new Date();
  const res = await db.costActual.createMany({
    data: claim.lines.map((l) => ({
      projectId,
      costCodeId: l.costCodeId,
      xeroSourceId: `claim:${claim.id}:${l.id}`,
      description: `Claim #${claim.claimNumber} — ${l.description}`,
      amountCents: l.claimedAmountCents,
      occurredAt,
    })),
    skipDuplicates: true,
  });
  return res.count;
}
