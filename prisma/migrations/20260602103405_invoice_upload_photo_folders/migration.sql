-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "folderId" TEXT;

-- AlterTable
ALTER TABLE "ProgressClaim" ADD COLUMN     "xeroInvoiceKey" TEXT,
ADD COLUMN     "xeroInvoiceName" TEXT;

-- CreateTable
CREATE TABLE "PhotoFolder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoFolder_projectId_idx" ON "PhotoFolder"("projectId");

-- CreateIndex
CREATE INDEX "Photo_folderId_idx" ON "Photo"("folderId");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "PhotoFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoFolder" ADD CONSTRAINT "PhotoFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
