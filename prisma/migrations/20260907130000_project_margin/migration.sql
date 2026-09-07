-- Per-project builder's margin. Margin is negotiated per contract, so a
-- portal-wide rate misstates any job agreed on a different one. NULL means
-- "inherit the company default", which is every existing row.
ALTER TABLE "Project" ADD COLUMN "marginPercent" DOUBLE PRECISION;
