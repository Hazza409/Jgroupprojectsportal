-- CreateTable
CREATE TABLE "SubcontractorContact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "trade" TEXT,
    "company" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubcontractorContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubcontractorContact_projectId_idx" ON "SubcontractorContact"("projectId");

-- AddForeignKey
ALTER TABLE "SubcontractorContact" ADD CONSTRAINT "SubcontractorContact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
