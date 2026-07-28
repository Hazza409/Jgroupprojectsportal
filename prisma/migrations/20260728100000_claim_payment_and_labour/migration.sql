-- QS-grade claim detail (Jake §5): payment status per claim, and labour backup
-- broken down by role at agreed rates instead of one lump "Labour" line.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClaimPaymentStatus') THEN
    CREATE TYPE "ClaimPaymentStatus" AS ENUM ('NOT_INVOICED', 'INVOICED', 'PAID');
  END IF;
END $$;

ALTER TABLE "ProgressClaim" ADD COLUMN IF NOT EXISTS "paymentStatus" "ClaimPaymentStatus" NOT NULL DEFAULT 'NOT_INVOICED';
ALTER TABLE "ProgressClaim" ADD COLUMN IF NOT EXISTS "invoicedAt" TIMESTAMP(3);
ALTER TABLE "ProgressClaim" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
ALTER TABLE "ProgressClaim" ADD COLUMN IF NOT EXISTS "paymentReference" TEXT;

CREATE TABLE IF NOT EXISTS "ClaimLabourEntry" (
  "id"          TEXT NOT NULL,
  "claimId"     TEXT NOT NULL,
  "role"        TEXT NOT NULL,
  "hours"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rateCents"   INTEGER NOT NULL DEFAULT 0,
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ClaimLabourEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClaimLabourEntry_claimId_idx" ON "ClaimLabourEntry"("claimId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClaimLabourEntry_claimId_fkey') THEN
    ALTER TABLE "ClaimLabourEntry" ADD CONSTRAINT "ClaimLabourEntry_claimId_fkey"
      FOREIGN KEY ("claimId") REFERENCES "ProgressClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Approved claims have necessarily been invoiced; reflect that once, up front.
UPDATE "ProgressClaim" SET "paymentStatus" = 'INVOICED'
WHERE "status" = 'APPROVED' AND "paymentStatus" = 'NOT_INVOICED';
