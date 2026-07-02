-- CreateTable
CREATE TABLE "ClaimInvoiceFile" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimInvoiceFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimInvoiceFile_claimId_idx" ON "ClaimInvoiceFile"("claimId");

-- AddForeignKey
ALTER TABLE "ClaimInvoiceFile" ADD CONSTRAINT "ClaimInvoiceFile_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ProgressClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
