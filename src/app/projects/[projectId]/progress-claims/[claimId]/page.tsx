import Link from "next/link";
import { notFound } from "next/navigation";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { formatCents, sumCents } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { projectDrawdown } from "@/lib/claims";
import { StatusBadge } from "@/components/StatusBadge";
import { ClaimLineForm } from "./ClaimLineForm";
import { ReconUploadForm } from "./ReconUploadForm";
import { InvoiceUploadForm } from "./InvoiceUploadForm";
import { DeleteClaimButton } from "./DeleteClaimButton";
import { MarkApprovedButton } from "./MarkApprovedButton";
import {
  generateClaimLines,
  deleteClaimLine,
  submitClaim,
  decideClaim,
  reopenClaim,
  uploadClaimInvoices,
  deleteClaimInvoiceFile,
} from "../actions";

const fmtDate = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(d) : null;

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
      reconLines: { orderBy: { id: "asc" } },
      invoiceFiles: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!claim) notFound();

  const costCodes = await db.costCode.findMany({
    where: { projectId },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  const isDraft = claim.status === "DRAFT";
  const fromSheet = claim.totalCents > 0 || claim.reconLines.length > 0;
  const lineSum = sumCents(claim.lines.map((l) => l.claimedAmountCents));
  const headline = fromSheet ? claim.totalCents : lineSum;
  const store = await storage();
  const reconUrl = claim.reconSheetKey ? await store.url(claim.reconSheetKey) : null;
  const invoiceUrl = claim.xeroInvoiceKey ? await store.url(claim.xeroInvoiceKey) : null;
  const backupUrls = new Map<string, string>();
  for (const f of claim.invoiceFiles) backupUrls.set(f.id, await store.url(f.fileKey));

  // Invoice-on-invoice drawdown position for THIS claim.
  const company = await getCompany();
  const drawdown = await projectDrawdown(projectId, company);
  const priorDrawnCents = drawdown.rows
    .filter((r) => r.claimNumber < claim.claimNumber && r.drawnToDateCents !== null)
    .reduce((acc, r) => acc + r.amountCents, 0);
  const isApproved = claim.status === "APPROVED";
  const position = [
    { label: "Budget (estimate + approved variations)", value: drawdown.budgetCents },
    { label: "Previously drawn (approved claims)", value: priorDrawnCents },
    { label: "This claim", value: headline },
    { label: isApproved ? "Drawn to date" : "Drawn to date (if approved)", value: priorDrawnCents + headline, strong: true },
    { label: "Remaining to draw", value: drawdown.budgetCents - priorDrawnCents - headline, strong: true },
  ];

  const summary = [
    { label: "Labour this period", value: claim.labourCents },
    { label: "Costs this period", value: claim.costsCents },
    { label: `Builder's margin (${claim.marginPercent}%)`, value: claim.marginCents },
    { label: "Subtotal (ex-GST)", value: claim.subtotalCents, strong: true },
    { label: "GST", value: claim.gstCents },
    { label: "Total claimed (inc GST)", value: claim.totalCents, strong: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/projects/${projectId}/progress-claims`} className="text-sm text-stone-500 hover:text-ink">
          ← All claims
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              Progress Claim #{claim.claimNumber}
              {claim.periodLabel ? ` · ${claim.periodLabel}` : ""}
            </h2>
            <p className="text-sm text-stone-500">
              {[
                claim.reconInvoiceRef,
                fmtDate(claim.periodEnd),
                `${formatCents(headline)} claimed`,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={claim.status} />
            <Link href={`/claims/${claimId}/print`} target="_blank" className="btn-ghost">
              View / PDF
            </Link>
            {isBuilder && isDraft && (
              <form action={submitClaim.bind(null, projectId, claimId)}>
                <button className="btn-primary" type="submit">Submit for approval</button>
              </form>
            )}
            {/* Onboarding existing projects: record historical approvals directly */}
            {isBuilder && (isDraft || claim.status === "SUBMITTED") && (
              <MarkApprovedButton projectId={projectId} claimId={claimId} claimNumber={claim.claimNumber} />
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
            {/* Knocked back (or withdrawn) → builder re-opens, edits, resubmits */}
            {isBuilder && (claim.status === "SUBMITTED" || claim.status === "REJECTED") && (
              <form action={reopenClaim.bind(null, projectId, claimId)}>
                <button className="btn-ghost" type="submit">Reopen as draft</button>
              </form>
            )}
            {isBuilder && claim.status !== "APPROVED" && (
              <DeleteClaimButton projectId={projectId} claimId={claimId} claimNumber={claim.claimNumber} />
            )}
          </div>
        </div>
      </div>

      {/* Build from reconciliation sheet (builder, draft) */}
      {isBuilder && isDraft && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Reconciliation sheet</h3>
          <ReconUploadForm projectId={projectId} claimId={claimId} hasSheet={!!claim.reconSheetKey} />
          {reconUrl && (
            <p className="mt-3 text-xs text-stone-400">
              Source: <a href={reconUrl} target="_blank" rel="noreferrer" className="underline">{claim.reconSheetName ?? "reconciliation sheet"}</a>
            </p>
          )}
        </div>
      )}

      {/* Claim summary (invoice-style) */}
      {fromSheet && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="card p-0">
            <div className="border-b border-stone-200 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
              Budget overview
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-5 py-3">Cost code</th>
                  <th className="px-4 py-3 text-right">This period</th>
                  <th className="px-4 py-3 text-right">Prior</th>
                  <th className="px-4 py-3 text-right">To date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {claim.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-2">{l.description}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {l.claimedAmountCents ? formatCents(l.claimedAmountCents) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-500">{formatCents(l.priorCents)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(l.toDateCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card h-fit">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">This claim</h3>
            <dl className="space-y-2 text-sm">
              {summary.map((s) => (
                <div
                  key={s.label}
                  className={`flex items-center justify-between ${
                    s.strong ? "border-t border-stone-200 pt-2 font-semibold" : ""
                  }`}
                >
                  <dt className={s.strong ? "" : "text-stone-500"}>{s.label}</dt>
                  <dd className="tabular-nums">{formatCents(s.value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* Invoice-on-invoice drawdown position */}
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Drawdown position</h3>
        <dl className="space-y-2 text-sm sm:max-w-md">
          {position.map((s) => (
            <div
              key={s.label}
              className={`flex items-center justify-between gap-6 ${
                s.strong ? "border-t border-stone-200 pt-2 font-semibold" : ""
              }`}
            >
              <dt className={s.strong ? "" : "text-stone-500"}>{s.label}</dt>
              <dd className="tabular-nums">{formatCents(s.value)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Tax invoice (Xero) with payment details — what the client pays from */}
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Tax invoice &amp; payment details
        </h3>
        {invoiceUrl ? (
          <a href={invoiceUrl} target="_blank" rel="noreferrer" className="btn-ghost inline-flex">
            Download tax invoice{claim.xeroInvoiceName ? ` (${claim.xeroInvoiceName})` : ""}
          </a>
        ) : (
          <p className="text-sm text-stone-500">
            {isBuilder
              ? "Upload the Xero-generated tax invoice (with your payment details)."
              : "The tax invoice will appear here once issued."}
          </p>
        )}
        {isBuilder && (
          <div className="mt-3">
            <InvoiceUploadForm projectId={projectId} claimId={claimId} hasInvoice={!!claim.xeroInvoiceKey} />
          </div>
        )}
      </div>


      {/* Uploaded supplier invoices — transparency backup the client can open */}
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Supplier invoices{claim.invoiceFiles.length > 0 ? ` · ${claim.invoiceFiles.length}` : ""}
        </h3>
        {claim.invoiceFiles.length === 0 ? (
          <p className="text-sm text-stone-500">
            {isBuilder
              ? "Upload the supplier invoices behind this claim so the client can see the backup."
              : "No supplier invoices attached yet."}
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {claim.invoiceFiles.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                <a
                  href={backupUrls.get(f.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate text-brand hover:underline"
                >
                  {f.originalName}
                </a>
                {isBuilder && (
                  <form action={deleteClaimInvoiceFile.bind(null, projectId, claimId, f.id)}>
                    <button className="shrink-0 text-xs text-red-700 dark:text-red-300 hover:text-red-200" type="submit">
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {isBuilder && (
          <form
            action={uploadClaimInvoices.bind(null, projectId, claimId)}
            className="mt-3 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-3"
          >
            <input type="file" name="files" accept=".pdf,image/*" multiple required className="text-sm" />
            <button className="btn-ghost" type="submit">Upload invoices</button>
          </form>
        )}
      </div>

      {/* Supplier backup */}
      {claim.reconLines.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-stone-500">
            Supporting detail · {claim.reconLines.length} supplier invoices
          </summary>
          <table className="mt-3 w-full text-sm">
            <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="py-2">Supplier</th>
                <th className="py-2">Document</th>
                <th className="py-2">Allocation</th>
                <th className="py-2 text-right">Amount (ex-GST)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {claim.reconLines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">{l.supplier}</td>
                  <td className="py-2 text-stone-500">{l.documentNumber ?? "—"}</td>
                  <td className="py-2 text-stone-500">{l.allocation ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums">{formatCents(l.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {/* Manual entry fallback (draft, no recon sheet) */}
      {isBuilder && isDraft && !fromSheet && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Add line item manually</h3>
            <form action={generateClaimLines.bind(null, projectId, claimId)}>
              <button className="btn-ghost" type="submit">Generate from cost codes</button>
            </form>
          </div>
          {claim.lines.length > 0 && (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                {claim.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 font-mono text-xs text-stone-400">{l.costCode?.code ?? "—"}</td>
                    <td className="py-2">{l.description}</td>
                    <td className="py-2 text-right tabular-nums">{formatCents(l.claimedAmountCents)}</td>
                    <td className="py-2 text-right">
                      <form action={deleteClaimLine.bind(null, projectId, claimId, l.id)}>
                        <button className="text-xs text-red-700 dark:text-red-300 hover:text-red-200" type="submit">Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ClaimLineForm projectId={projectId} claimId={claimId} costCodes={costCodes} />
        </div>
      )}

      <p className="text-xs text-stone-400">
        Approved claims are flagged for a separate, manual Xero invoice push — money movement never auto-fires.
      </p>
    </div>
  );
}
