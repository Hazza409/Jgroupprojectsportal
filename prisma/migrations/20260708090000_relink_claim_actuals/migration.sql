-- Claims → Cost to Complete reconciliation, round 2 (idempotent throughout).
--
-- Real-world estimate vs reconciliation sheets drift in naming ("Fire Places"
-- vs "Fireplaces", "P.C items" vs "P.C.Items"), so many claim lines never got
-- a costCodeId and their amounts were invisible on Cost to Complete.

-- 1) Re-link: attach unlinked claim lines to cost codes when both names match
--    after normalization (lowercase, "&"→"and", letters+digits only). Typo-
--    level matches (e.g. "Balustarde") are handled by the in-app fuzzy matcher
--    ("Re-match claim costs" button / on approval).
UPDATE "ClaimLineItem" AS cli
SET "costCodeId" = m."ccId"
FROM (
  SELECT DISTINCT ON (cli2."id") cli2."id" AS "lineId", cc."id" AS "ccId"
  FROM "ClaimLineItem" cli2
  JOIN "ProgressClaim" pc ON pc."id" = cli2."claimId"
  JOIN "CostCode" cc
    ON cc."projectId" = pc."projectId"
   AND regexp_replace(replace(lower(cc."name"), '&', 'and'), '[^a-z0-9]', '', 'g')
     = regexp_replace(replace(lower(cli2."description"), '&', 'and'), '[^a-z0-9]', '', 'g')
  WHERE cli2."costCodeId" IS NULL
  ORDER BY cli2."id", cc."code" ASC
) AS m
WHERE cli."id" = m."lineId";

-- 2) Post ALL approved-claim lines into the cost feed — including ones still
--    matching no cost code, which now surface as "Unallocated" on Cost to
--    Complete so the page total reconciles with the Progress Claims register.
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
  AND cli."claimedAmountCents" <> 0
ON CONFLICT ("projectId", "xeroSourceId") DO NOTHING;

-- 3) Sync linkage on rows posted before their line was re-linked (step 1 may
--    have attached codes to lines whose actuals already exist).
UPDATE "CostActual" AS ca
SET "costCodeId" = cli."costCodeId"
FROM "ClaimLineItem" cli
JOIN "ProgressClaim" pc ON pc."id" = cli."claimId"
WHERE ca."projectId" = pc."projectId"
  AND ca."xeroSourceId" = 'claim:' || pc."id" || ':' || cli."id"
  AND ca."costCodeId" IS DISTINCT FROM cli."costCodeId";
