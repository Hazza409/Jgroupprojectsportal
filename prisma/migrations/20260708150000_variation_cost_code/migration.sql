-- Allocate variations to cost codes so Cost to Complete can show a
-- "Variations" column per code (idempotent / additive).

-- 1) Column + FK + index (guarded so re-run is safe).
ALTER TABLE "Variation" ADD COLUMN IF NOT EXISTS "costCodeId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Variation_costCodeId_fkey'
  ) THEN
    ALTER TABLE "Variation"
      ADD CONSTRAINT "Variation_costCodeId_fkey"
      FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Variation_costCodeId_idx" ON "Variation"("costCodeId");

-- 2) Backfill: match each unallocated variation's TITLE to a cost code by
--    normalized name (lowercase, "&"->"and", strip non-alnum). Exact-match
--    only in SQL; the in-app fuzzy matcher (title typos/plurals) fills the rest
--    when a builder opens/edits the variation or re-imports. Deterministic:
--    lowest code wins a tie.
UPDATE "Variation" AS v
SET "costCodeId" = m."ccId"
FROM (
  SELECT DISTINCT ON (v2."id") v2."id" AS "vId", cc."id" AS "ccId"
  FROM "Variation" v2
  JOIN "CostCode" cc
    ON cc."projectId" = v2."projectId"
   AND regexp_replace(replace(lower(cc."name"), '&', 'and'), '[^a-z0-9]', '', 'g')
     = regexp_replace(replace(lower(v2."title"), '&', 'and'), '[^a-z0-9]', '', 'g')
  WHERE v2."costCodeId" IS NULL
  ORDER BY v2."id", cc."code" ASC
) AS m
WHERE v."id" = m."vId";
