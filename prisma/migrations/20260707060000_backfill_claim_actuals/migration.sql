-- Backfill: post already-APPROVED progress claims' per-cost-code amounts into
-- CostActual so Cost to Complete's "Current to Date" includes them. Going
-- forward decideClaim does this at approval time (src/lib/claims.ts) with the
-- same claim:<claimId>:<lineId> source key.
--
-- Idempotent: the (projectId, xeroSourceId) unique constraint + ON CONFLICT
-- DO NOTHING makes this safe to run any number of times (no double counting,
-- including against rows the app has already materialized).
INSERT INTO "CostActual"
  ("id", "projectId", "costCodeId", "xeroAccountCode", "xeroSourceId",
   "description", "amountCents", "occurredAt", "syncedAt")
SELECT
  'clmfill_' || substr(md5(pc."id" || ':' || cli."id"), 1, 24),
  pc."projectId",
  cli."costCodeId",
  NULL,
  'claim:' || pc."id" || ':' || cli."id",
  'Claim #' || pc."claimNumber" || ' — ' || cli."description",
  cli."claimedAmountCents",
  COALESCE(pc."approvedAt", now()),
  now()
FROM "ClaimLineItem" cli
JOIN "ProgressClaim" pc ON pc."id" = cli."claimId"
WHERE pc."status" = 'APPROVED'
  AND cli."costCodeId" IS NOT NULL
  AND cli."claimedAmountCents" <> 0
ON CONFLICT ("projectId", "xeroSourceId") DO NOTHING;
