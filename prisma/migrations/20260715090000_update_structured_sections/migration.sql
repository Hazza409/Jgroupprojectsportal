-- Structured fortnightly-summary sections on ProjectUpdate (all optional, additive).
ALTER TABLE "ProjectUpdate" ADD COLUMN IF NOT EXISTS "tradesOnSite" TEXT;
ALTER TABLE "ProjectUpdate" ADD COLUMN IF NOT EXISTS "worksCompleted" TEXT;
ALTER TABLE "ProjectUpdate" ADD COLUMN IF NOT EXISTS "upcomingWorks" TEXT;
ALTER TABLE "ProjectUpdate" ADD COLUMN IF NOT EXISTS "delaysNotes" TEXT;

-- `body` becomes optional (general notes); default '' so existing NOT NULL rows
-- and new inserts without a body are both valid.
ALTER TABLE "ProjectUpdate" ALTER COLUMN "body" SET DEFAULT '';
