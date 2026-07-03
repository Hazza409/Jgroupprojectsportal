-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "tagline" TEXT,
    "location" TEXT,
    "printFooter" TEXT,
    "logoKey" TEXT,
    "brandColorDark" TEXT,
    "brandColorLight" TEXT,
    "marginPercent" DOUBLE PRECISION NOT NULL DEFAULT 12.5,
    "gstPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- Seed the first (and, until SAAS-PLAN M2, only) company: J Group. Runs via
-- `prisma migrate deploy` on Render, so the live site self-seeds with its
-- current branding and looks identical after this deploy.
INSERT INTO "Company" ("id", "name", "shortName", "tagline", "location", "printFooter", "marginPercent", "gstPercent", "updatedAt")
VALUES ('company_jgroup', 'J Group Projects', 'J Group', 'One Of One', 'Sydney', 'Design · Construction · Landscape', 12.5, 10, CURRENT_TIMESTAMP);
