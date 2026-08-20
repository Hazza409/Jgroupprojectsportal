-- Durable per-line forecast history + forecast publication in the Decision
-- Register (portal audit, 21 Aug 2026).
--
-- CostCode holds only the CURRENT forecast, so republishing a line overwrote
-- the previous figure and the notice trail died with it. On cost plus the
-- question in dispute is "what were we told this line would finish at, and
-- when" — that must survive every later revision.

-- New enum values (Postgres requires these to be added, not replaced).
ALTER TYPE "DecisionAction"  ADD VALUE IF NOT EXISTS 'PUBLISHED';
ALTER TYPE "DecisionSubject" ADD VALUE IF NOT EXISTS 'FORECAST';

-- Append-only publication history. No UPDATE/DELETE path exists in the app.
CREATE TABLE "CostCodeForecastEntry" (
    "id"                  TEXT NOT NULL,
    "projectId"           TEXT NOT NULL,
    "costCodeId"          TEXT NOT NULL,
    "revision"            TEXT NOT NULL,
    "forecastCents"       INTEGER NOT NULL,
    "approvedBudgetCents" INTEGER NOT NULL,
    "note"                TEXT,
    "publishedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByName"     TEXT NOT NULL,
    "publishedByEmail"    TEXT NOT NULL,
    CONSTRAINT "CostCodeForecastEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CostCodeForecastEntry_projectId_publishedAt_idx"  ON "CostCodeForecastEntry"("projectId", "publishedAt");
CREATE INDEX "CostCodeForecastEntry_costCodeId_publishedAt_idx" ON "CostCodeForecastEntry"("costCodeId", "publishedAt");

ALTER TABLE "CostCodeForecastEntry"
  ADD CONSTRAINT "CostCodeForecastEntry_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostCodeForecastEntry"
  ADD CONSTRAINT "CostCodeForecastEntry_costCodeId_fkey"
  FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
