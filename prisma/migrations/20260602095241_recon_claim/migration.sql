-- AlterTable
ALTER TABLE "ClaimLineItem" ADD COLUMN     "priorCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "toDateCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProgressClaim" ADD COLUMN     "costsCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gstCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "labourCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "marginCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "marginPercent" DOUBLE PRECISION NOT NULL DEFAULT 12.5,
ADD COLUMN     "periodLabel" TEXT,
ADD COLUMN     "reconInvoiceRef" TEXT,
ADD COLUMN     "subtotalCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ClaimReconLine" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "documentNumber" TEXT,
    "allocation" TEXT,
    "amountCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ClaimReconLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimReconLine_claimId_idx" ON "ClaimReconLine"("claimId");

-- AddForeignKey
ALTER TABLE "ClaimReconLine" ADD CONSTRAINT "ClaimReconLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ProgressClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
