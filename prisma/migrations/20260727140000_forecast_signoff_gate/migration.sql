-- Fortnightly sign-off gate: nothing publishes to a client until every
-- configured approver has signed the CURRENT revision of the figures.

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "forecastApprovers" TEXT;

-- Pending (internal) forecast figures, separate from the published set.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pendingForecastFinalCostCents" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pendingForecastFinalCostNote" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pendingForecastCompletionDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pendingForecastCompletionNote" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pendingForecastUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pendingForecastUpdatedBy" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pendingForecastRevision" TEXT;

CREATE TABLE IF NOT EXISTS "ForecastSignoff" (
  "id"             TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "revision"       TEXT NOT NULL,
  "signedById"     TEXT,
  "signedByName"   TEXT NOT NULL,
  "signedByEmail"  TEXT NOT NULL,
  "signedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalCostCents" INTEGER,
  "completionDate" TIMESTAMP(3),
  CONSTRAINT "ForecastSignoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ForecastSignoff_projectId_revision_signedByEmail_key"
  ON "ForecastSignoff"("projectId", "revision", "signedByEmail");
CREATE INDEX IF NOT EXISTS "ForecastSignoff_projectId_revision_idx"
  ON "ForecastSignoff"("projectId", "revision");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForecastSignoff_projectId_fkey') THEN
    ALTER TABLE "ForecastSignoff" ADD CONSTRAINT "ForecastSignoff_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Existing already-published figures stay published; nothing pending yet.
