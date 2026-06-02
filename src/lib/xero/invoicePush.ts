// ─────────────────────────────────────────────────────────────
// ⚠️  MONEY MOVEMENT — APPROVED CLAIM → XERO INVOICE.
//
// This is deliberately NOT implemented and must NEVER auto-fire. Pushing an
// invoice to Xero creates a real financial document. It requires an explicit,
// audited, human-triggered action and the accounting.transactions write scope.
//
// The interface below defines the contract. Implementing it is a conscious,
// reviewed decision — not part of the normal approval flow.
// ─────────────────────────────────────────────────────────────

import { db } from "../db";
import { ClaimStatus } from "@prisma/client";

export interface InvoicePushResult {
  xeroInvoiceId: string;
}

/**
 * TODO (guarded): create a Xero ACCREC invoice from an APPROVED progress claim.
 * Preconditions to enforce when implemented:
 *   - claim.status === APPROVED
 *   - claim not already pushed (xeroInvoiceId == null)
 *   - explicit operator confirmation captured in the caller
 */
export async function pushApprovedClaimToXero(claimId: string): Promise<InvoicePushResult> {
  const claim = await db.progressClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new Error("Claim not found");
  if (claim.status !== ClaimStatus.APPROVED) {
    throw new Error("Only APPROVED claims may be pushed to Xero.");
  }
  if (claim.xeroInvoiceId) {
    throw new Error("Claim already pushed to Xero.");
  }

  // TODO: POST invoice to Xero Accounting API, then:
  //   await db.progressClaim.update({ where: { id: claimId }, data: { xeroInvoiceId } });
  throw new Error(
    "Xero invoice push is intentionally not enabled. Implement deliberately — see src/lib/xero/invoicePush.ts.",
  );
}
