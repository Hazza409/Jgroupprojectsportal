-- A client deposit repaid by reducing later invoices. Separate from the
-- contract sum: it buys no work, so it is kept out of the claim total and
-- never affects the budget drawdown. Recorded so a claim can still reconcile
-- to the invoice the client received.
ALTER TABLE "ProgressClaim" ADD COLUMN "depositCreditCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProgressClaim" ADD COLUMN "depositLabel" TEXT;
