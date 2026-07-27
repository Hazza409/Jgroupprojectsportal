-- Evidence layer (immutable decision ledger + internal view logging) and the
-- two manually-entered headline forecast figures. Idempotent throughout.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DecisionAction') THEN
    CREATE TYPE "DecisionAction" AS ENUM ('APPROVED', 'REJECTED', 'ACKNOWLEDGED', 'ANSWERED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DecisionSubject') THEN
    CREATE TYPE "DecisionSubject" AS ENUM ('VARIATION', 'CLAIM', 'UPDATE', 'QUERY');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DecisionRecord" (
  "id"           TEXT NOT NULL,
  "projectId"    TEXT NOT NULL,
  "subjectType"  "DecisionSubject" NOT NULL,
  "subjectId"    TEXT NOT NULL,
  "subjectRef"   TEXT NOT NULL,
  "subjectTitle" TEXT,
  "action"       "DecisionAction" NOT NULL,
  "actorId"      TEXT,
  "actorName"    TEXT NOT NULL,
  "actorEmail"   TEXT NOT NULL,
  "actorRole"    "Role" NOT NULL,
  "amountCents"  INTEGER,
  "versionHash"  TEXT,
  "detail"       TEXT,
  "occurredAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DecisionRecord_projectId_occurredAt_idx" ON "DecisionRecord"("projectId", "occurredAt");
CREATE INDEX IF NOT EXISTS "DecisionRecord_subjectType_subjectId_idx" ON "DecisionRecord"("subjectType", "subjectId");

CREATE TABLE IF NOT EXISTS "ViewLog" (
  "id"        TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId"    TEXT,
  "userName"  TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "userRole"  "Role" NOT NULL,
  "path"      TEXT NOT NULL,
  "label"     TEXT,
  "viewedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ViewLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ViewLog_projectId_viewedAt_idx" ON "ViewLog"("projectId", "viewedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DecisionRecord_projectId_fkey') THEN
    ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ViewLog_projectId_fkey') THEN
    ALTER TABLE "ViewLog" ADD CONSTRAINT "ViewLog_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- The two headline figures — entered by hand each fortnight, never computed.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "forecastFinalCostCents" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "forecastFinalCostPrevCents" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "forecastFinalCostNote" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "forecastCompletionDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "forecastCompletionPrevDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "forecastCompletionNote" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "forecastUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "forecastUpdatedBy" TEXT;
