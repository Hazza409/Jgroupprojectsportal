-- Post approved claims' LABOUR into the cost feed (idempotent).
--
-- J Group recon sheets carry the builder's own labour as a summary figure, not
-- a budget-overview line, so it never reached Cost to Complete: the "Labour"
-- cost code sat at $0 while the drawdown ledger included it (~$215k gap seen
-- on the live Mona Vale project). Going forward materializeClaimActuals posts
-- it on approval with the same claim:<claimId>:labour key.
--
-- Guard: skipped when a claim line already maps to the project's Labour cost
-- code (then the sheet covered labour itself — inserting would double-count).
INSERT INTO "CostActual"
  ("id", "projectId", "costCodeId", "xeroAccountCode", "xeroSourceId",
   "description", "amountCents", "occurredAt", "syncedAt")
SELECT
  'clmlab_' || substr(md5(pc."id"), 1, 24),
  pc."projectId",
  lab."id",
  NULL,
  'claim:' || pc."id" || ':labour',
  'Claim #' || pc."claimNumber" || ' — Labour',
  pc."labourCents",
  COALESCE(pc."approvedAt", now()),
  now()
FROM "ProgressClaim" pc
LEFT JOIN LATERAL (
  SELECT cc."id"
  FROM "CostCode" cc
  WHERE cc."projectId" = pc."projectId"
    AND regexp_replace(replace(lower(cc."name"), '&', 'and'), '[^a-z0-9]', '', 'g') = 'labour'
  ORDER BY cc."code" ASC
  LIMIT 1
) lab ON TRUE
WHERE pc."status" = 'APPROVED'
  AND pc."labourCents" <> 0
  AND NOT EXISTS (
    SELECT 1 FROM "ClaimLineItem" cli
    WHERE cli."claimId" = pc."id"
      AND lab."id" IS NOT NULL
      AND cli."costCodeId" = lab."id"
  )
ON CONFLICT ("projectId", "xeroSourceId") DO NOTHING;
