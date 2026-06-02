import Link from "next/link";
import { notFound } from "next/navigation";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { formatCents, sumCents } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { ClaimLineForm } from "./ClaimLineForm";
import {
  generateClaimLines,
  deleteClaimLine,
  uploadReconSheet,
  submitClaim,
  decideClaim,
} from "../actions";

export default async function ClaimDetailPage({
  params,
}: {
  params: { projectId: string; claimId: string };
}) {
  const user = await assertProjectAccess(params.projectId);
  const { projectId, claimId } = params;
  const isBuilder = user.role === "BUILDER";

  const claim = await db.progressClaim.findFirst({
    where: { id: claimId, projectId },
    include: {
      lines: { include: { costCode: { select: { code: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!claim) notFound();

  const costCodes = await db.costCode.findMany({
    where: { projectId },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  const total = sumCents(claim.lines.map((l) => l.claimedAmountCents));
  const isDraft = claim.status === "DRAFT";
  const reconUrl = claim.reconSheetKey ? await (await storage()).url(claim.reconSheetKey) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/projects/${projectId}/progress-claims`} className="text-sm text-stone-500 hover:text-ink">
          ← All claims
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Progress Claim #{claim.claimNumber}</h2>
            <p className="text-sm text-stone-500">{claim.lines.length} line item(s) · {formatCents(total)}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={claim.status} />
            {isBuilder && isDraft && (
              <form action={submitClaim.bind(null, projectId, claimId)}>
                <button className="btn-primary" type="submit">Submit for approval</button>
              </form>
            )}
            {claim.status === "SUBMITTED" && (
              <>
                <form action={decideClaim.bind(null, projectId, claimId, true)}>
                  <button className="btn-primary" type="submit">Approve</button>
                </form>
                <form action={decideClaim.bind(null, projectId, claimId, false)}>
                  <button className="btn-ghost" type="submit">Reject</button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Reconciliation sheet */}
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Reconciliation sheet</h3>
        {reconUrl ? (
          <a href={reconUrl} className="text-sm text-ink underline" target="_blank" rel="noreferrer">
            View attached reconciliation sheet
          </a>
        ) : (
          <p className="text-sm text-stone-500">No reconciliation sheet attached.</p>
        )}
        {isBuilder && isDraft && (
          <form action={uploadReconSheet.bind(null, projectId, claimId)} className="mt-3 flex items-center gap-3">
            <input
              type="file"
              name="file"
              accept=".xlsx,.xls,.pdf"
              required
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm"
            />
            <button className="btn-ghost" type="submit">{reconUrl ? "Replace" : "Attach"}</button>
          </form>
        )}
      </div>

      {/* Line items */}
      <div className="card p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">% complete</th>
              <th className="px-4 py-3 text-right">Amount claimed</th>
              {isBuilder && isDraft && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {claim.lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-stone-500">No line items yet.</td>
              </tr>
            ) : (
              claim.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 font-mono text-xs text-stone-400">{l.costCode?.code ?? "—"}</td>
                  <td className="px-4 py-2">{l.description}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Math.round(l.percentComplete)}%</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCents(l.claimedAmountCents)}</td>
                  {isBuilder && isDraft && (
                    <td className="px-4 py-2 text-right">
                      <form action={deleteClaimLine.bind(null, projectId, claimId, l.id)}>
                        <button className="text-xs text-red-300 hover:text-red-200" type="submit">Remove</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="border-t border-stone-200 bg-stone-50 font-semibold">
            <tr>
              <td colSpan={3} className="px-4 py-3">Total this claim</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatCents(total)}</td>
              {isBuilder && isDraft && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Builder editing tools */}
      {isBuilder && isDraft && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Add line item</h3>
            <form action={generateClaimLines.bind(null, projectId, claimId)}>
              <button className="btn-ghost" type="submit">Generate from cost codes</button>
            </form>
          </div>
          <ClaimLineForm projectId={projectId} claimId={claimId} costCodes={costCodes} />
        </div>
      )}

      <p className="text-xs text-stone-400">
        Approved claims are flagged for a separate, manual Xero invoice push (see{" "}
        <code>src/lib/xero/invoicePush.ts</code>) — money movement never auto-fires.
      </p>
    </div>
  );
}
