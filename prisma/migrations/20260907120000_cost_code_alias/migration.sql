-- Cost-code aliases: map a reconciliation sheet's trade names onto the
-- estimate's cost codes. Many aliases may point at one cost code, which is
-- how two sheet lines ("Mechanical", "Mechanical Ventilation") merge into a
-- single budget line.
CREATE TABLE "CostCodeAlias" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "costCodeId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostCodeAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CostCodeAlias_projectId_alias_key" ON "CostCodeAlias"("projectId", "alias");
CREATE INDEX "CostCodeAlias_costCodeId_idx" ON "CostCodeAlias"("costCodeId");

ALTER TABLE "CostCodeAlias" ADD CONSTRAINT "CostCodeAlias_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostCodeAlias" ADD CONSTRAINT "CostCodeAlias_costCodeId_fkey"
    FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
