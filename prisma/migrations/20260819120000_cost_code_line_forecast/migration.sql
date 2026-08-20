-- Per-cost-code forecast, staged and published like the project forecast.
--
-- Lets a cost movement be forecast BEFORE spend passes the estimate, so the
-- client is given notice rather than discovering a line already over.
-- Nullable throughout: an unset forecast means "no view yet", which is
-- different from a forecast of zero.
ALTER TABLE "CostCode" ADD COLUMN "pendingForecastCents" INTEGER;
ALTER TABLE "CostCode" ADD COLUMN "pendingForecastNote"  TEXT;
ALTER TABLE "CostCode" ADD COLUMN "forecastCents"        INTEGER;
ALTER TABLE "CostCode" ADD COLUMN "forecastNote"         TEXT;
ALTER TABLE "CostCode" ADD COLUMN "forecastPublishedAt"  TIMESTAMP(3);
