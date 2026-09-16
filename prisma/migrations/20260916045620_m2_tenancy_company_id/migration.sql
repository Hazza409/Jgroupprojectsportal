-- Tenancy (SAAS-PLAN M2): every User and Project belongs to exactly one
-- Company. The LIVE database holds real J Group jobs, so this must be safe on a
-- non-empty table: add the column NULLable, backfill every existing row to the
-- oldest (first) company — J Group on production — then lock it to NOT NULL.
-- Nothing visible changes: there is only one company today.

-- AlterTable — nullable first (tables are not empty in production)
ALTER TABLE "Project" ADD COLUMN "companyId" TEXT;
ALTER TABLE "User" ADD COLUMN "companyId" TEXT;

-- Backfill: assign every existing row to the oldest company.
UPDATE "Project" SET "companyId" = (SELECT id FROM "Company" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "companyId" IS NULL;
UPDATE "User" SET "companyId" = (SELECT id FROM "Company" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "companyId" IS NULL;

-- Lock down
ALTER TABLE "Project" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "companyId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Project_companyId_idx" ON "Project"("companyId");
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
