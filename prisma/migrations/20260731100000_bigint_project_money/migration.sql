-- Whole-project money must not be capped at INT4.
--
-- 2,147,483,647 cents is $21,474,836.47 — smaller than real jobs here, so
-- creating a $37.9M project failed outright with a raw driver error. Widen the
-- project-level money columns to BIGINT (int8). Widening is lossless and
-- rewrites nothing; per-line amounts stay INT4, which is ample.
ALTER TABLE "Project" ALTER COLUMN "contractValueCents" TYPE BIGINT;
ALTER TABLE "Project" ALTER COLUMN "forecastFinalCostCents" TYPE BIGINT;
ALTER TABLE "Project" ALTER COLUMN "forecastFinalCostPrevCents" TYPE BIGINT;
ALTER TABLE "Project" ALTER COLUMN "pendingForecastFinalCostCents" TYPE BIGINT;
ALTER TABLE "ForecastSignoff" ALTER COLUMN "finalCostCents" TYPE BIGINT;
