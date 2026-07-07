-- Move variation→cost-code allocation down to the LINE ITEM level so one
-- variation can span multiple trades (idempotent / additive).

-- 1) Column + FK + index (guarded).
ALTER TABLE "VariationLineItem" ADD COLUMN IF NOT EXISTS "costCodeId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VariationLineItem_costCodeId_fkey'
  ) THEN
    ALTER TABLE "VariationLineItem"
      ADD CONSTRAINT "VariationLineItem_costCodeId_fkey"
      FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "VariationLineItem_costCodeId_idx" ON "VariationLineItem"("costCodeId");

-- 2) Backfill from the parent variation's code (set by the prior migration),
--    so nothing already allocated is lost.
UPDATE "VariationLineItem" AS li
SET "costCodeId" = v."costCodeId"
FROM "Variation" v
WHERE li."variationId" = v."id"
  AND li."costCodeId" IS NULL
  AND v."costCodeId" IS NOT NULL;

-- 3) For lines still unallocated, match the LINE's own description to a cost
--    code by normalized name (exact only in SQL; the in-app fuzzy matcher
--    handles typos/plurals when a builder opens/edits/re-imports).
UPDATE "VariationLineItem" AS li
SET "costCodeId" = m."ccId"
FROM (
  SELECT DISTINCT ON (li2."id") li2."id" AS "liId", cc."id" AS "ccId"
  FROM "VariationLineItem" li2
  JOIN "Variation" v2 ON v2."id" = li2."variationId"
  JOIN "CostCode" cc
    ON cc."projectId" = v2."projectId"
   AND regexp_replace(replace(lower(cc."name"), '&', 'and'), '[^a-z0-9]', '', 'g')
     = regexp_replace(replace(lower(li2."description"), '&', 'and'), '[^a-z0-9]', '', 'g')
  WHERE li2."costCodeId" IS NULL
  ORDER BY li2."id", cc."code" ASC
) AS m
WHERE li."id" = m."liId";
