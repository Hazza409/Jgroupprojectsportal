import Link from "next/link";
import { notFound } from "next/navigation";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { formatCents } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { projectDrawdown, claimHeadlineCents } from "@/lib/claims";
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
  acknowledgeClaim,
  setClaimPayment,
  addClaimLabour,
  deleteClaimLabour,
} from "../actions";
import { AUTHORITY_STATEMENT, ACKNOWLEDGEMENT_STATEMENT, logView, acknowledgementsForClaim } from "@/lib/audit";
import { fmtDateShort as fmtDate, fmtDateTime } from "@/lib/dates";

const PAYMENT_LABEL: Record<string, string> = {
  NOT_INVOICED: "Not yet invoiced",
  INVOICED: "Invoiced — awaiting payment",
  PAID: "Paid",
};

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
      labourEntries: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!claim) notFound();
  // A DRAFT claim hasn't been issued — internal only, no client deep link. Jake §1.
  if (!isBuilder && claim.status === "DRAFT") notFound();

  const costCodes = await db.costCode.findMany({
    where: { projectId },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  const isDraft = claim.status === "DRAFT";
  const fromSheet = claim.totalCents > 0 || claim.reconLines.length > 0;

  // Receipt trail + labour backup (Jake §2, §5).
  const acknowledgements = await acknowledgementsForClaim(claimId);
  const labourEntries = claim.labourEntries;
  const labourHoursTotal = labourEntries.reduce((a, e) => a + e.hours, 0);
  const labourAmountTotal = labourEntries.reduce((a, e) => a + e.amountCents, 0);
  await logView(projectId, user, `/projects/${projectId}/progress-claims/${claimId}`, `Progress Claim #${claim.claimNumber}`);
  const store = await storage();
  const reconUrl = claim.reconSheetKey ? await store.url(claim.reconSheetKey) : null;
  const invoiceUrl = claim.xeroInvoiceKey ? await store.url(claim.xeroInvoiceKey) : null;
  const backupUrls = new Map<string, string>();
  for (const f of claim.invoiceFiles) backupUrls.set(f.id, await store.url(f.fileKey));

  // Invoice-on-invoice drawdown position for THIS claim. claimHeadlineCents is
  // the single client-facing basis (inc margin+GST) shared with the register,
  // ledger, overview, and print — so "This claim" agrees across every page.
  const company = await getCompany();
  const headline = claimHeadlineCents(claim, company);
  const drawdown = await projectDrawdown(projectId, company);
  const priorDrawnCents = drawdown.rows
    .filter((r) => r.claimNumber < claim.claimNumber && r.drawnToDateCents !== null)
    .reduce((acc, r) => acc + r.amountCents, 0);
  const isApproved = claim.status === "APPROVED";
  const position = [
    { label: "Current budget (estimate + approved variations)", value: drawdown.budgetCents },
    { label: "Previously invoiced (approved claims)", value: priorDrawnCents },
    { label: "This claim", value: headline },
    { label: isApproved ? "Invoiced to date" : "Invoiced to date (if approved)", value: priorDrawnCents + headline, strong: true },
    { label: "Remaining against current budget", value: drawdown.budgetCents - priorDrawnCents - headline, strong: true },
  ];

  // GST must ALWAYS show as its own line, not just "amounts include GST"
  // (Jake §5). Recon-built claims carry stored figures from the sheet; manual
  // claims derive theirs from the line sum so the breakdown is never missing.
  const lineBase = claim.lines.reduce((a, l) => a + l.claimedAmountCents, 0);
  const manualMargin = Math.round(lineBase * (company.marginPercent / 100));
  const manualSubtotal = lineBase + manualMargin;
  const manualGst = Math.round(manualSubtotal * (company.gstPercent / 100));
  const summary = fromSheet
    ? [
        { label: "Labour this period", value: claim.labourCents },
        { label: "Costs this period", value: claim.costsCents },
        { label: `Builder's margin (${claim.marginPercent}%)`, value: claim.marginCents },
        { label: "Subtotal (ex-GST)", value: claim.subtotalCents, strong: true },
        { label: "GST", value: claim.gstCents },
        { label: "Total claimed (inc GST)", value: claim.totalCents, strong: true },
      ]
    : [
        { label: "Works this period (ex margin & GST)", value: lineBase },
        { label: `Builder's margin (${company.marginPercent}%)`, value: manualMargin },
        { label: "Subtotal (ex-GST)", value: manualSubtotal, strong: true },
        { label: `GST (${company.gstPercent}%)`, value: manualGst },
        { label: "Total claimed (inc GST)", value: manualSubtotal + manualGst, strong: true },
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
            {/* Approve/Reject moved below so the authority statement sits with it. */}
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

      {/* Approval — the client's own click is the record (Jake §2). The
          authority statement is what turns that click into acceptance. */}
      {claim.status === "SUBMITTED" && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-3">
            <form action={decideClaim.bind(null, projectId, claimId, true)}>
              <button className="btn-primary" type="submit">
                {isBuilder ? "Record client approval" : `Approve — ${formatCents(headline)}`}
              </button>
            </form>
            <form action={decideClaim.bind(null, projectId, claimId, false)}>
              <button className="btn-ghost" type="submit">{isBuilder ? "Record rejection" : "Reject"}</button>
            </form>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            {isBuilder
              ? "Recording a decision here is logged against your name as received outside the portal. The client's own click is the stronger record."
              : AUTHORITY_STATEMENT}
          </p>
        </div>
      )}

      {/* Acknowledgement — RECEIPT, not approval (Jake §2). Available on every
          issued claim, so a client can't later say they never saw it. */}
      {!isDraft && (
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-stone-400">Receipt</p>
          {acknowledgements.length > 0 && (
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
              ✓ Acknowledged by {acknowledgements.map((a) => `${a.actorName} (${fmtDateTime(a.occurredAt)})`).join(", ")}
            </p>
          )}
          {!isBuilder && !acknowledgements.some((a) => a.actorId === user.id) && (
            <form action={acknowledgeClaim.bind(null, projectId, claimId)} className="mt-2">
              <button className="btn-ghost" type="submit">Acknowledge receipt</button>
              <span className="ml-2 text-xs text-stone-400">{ACKNOWLEDGEMENT_STATEMENT}</span>
            </form>
          )}
          {isBuilder && acknowledgements.length === 0 && (
            <p className="mt-1 text-xs text-stone-400">Not yet acknowledged by the client.</p>
          )}
        </div>
      )}

      {/* Payment status — so the client's family office can self-serve (Jake §5). */}
      {!isDraft && (
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-stone-400">Payment status</p>
          <p className="mt-1 text-sm">
            <span className="font-medium">{PAYMENT_LABEL[claim.paymentStatus]}</span>
            {claim.invoicedAt && ` · invoiced ${fmtDate(claim.invoicedAt)}`}
            {claim.paidAt && ` · paid ${fmtDate(claim.paidAt)}`}
            {claim.paymentReference && ` · ref ${claim.paymentReference}`}
          </p>
          {isBuilder && (
            <form action={setClaimPayment.bind(null, projectId, claimId)} className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <label className="label">Status</label>
                <select name="paymentStatus" defaultValue={claim.paymentStatus} className="input">
                  <option value="NOT_INVOICED">Not invoiced</option>
                  <option value="INVOICED">Invoiced</option>
                  <option value="PAID">Paid</option>
                </select>
              </div>
              <div>
                <label className="label">Reference / receipt</label>
                <input name="paymentReference" defaultValue={claim.paymentReference ?? ""} className="input" placeholder="e.g. Xero INV-0042" />
              </div>
              <button className="btn-ghost" type="submit">Save</button>
            </form>
          )}
        </div>
      )}

      {/* Labour backup — hours by ROLE at agreed rates, behind a detail click
          (Jake §5: a client-side QS wants this, not one "Labour" line). */}
      {(labourEntries.length > 0 || isBuilder) && (
        <details className="card" open={labourEntries.length > 0 && !isBuilder}>
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-stone-500">
            Labour detail — hours by role
            {labourEntries.length > 0 && (
              <span className="ml-2 font-normal normal-case text-stone-400">
                {labourHoursTotal.toLocaleString("en-AU")} hrs · {formatCents(labourAmountTotal)}
              </span>
            )}
          </summary>
          {labourEntries.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">No labour breakdown recorded for this claim yet.</p>
          ) : (
            <table className="mt-3 w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[40%]" /><col className="w-[15%]" /><col className="w-[20%]" /><col className="w-[20%]" />
                {isBuilder && <col className="w-[5%]" />}
              </colgroup>
              <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="py-2">Role</th>
                  <th className="py-2 text-right">Hours</th>
                  <th className="py-2 text-right">Rate</th>
                  <th className="py-2 text-right">Amount</th>
                  {isBuilder && <th className="py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {labourEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 break-words">{e.role}</td>
                    <td className="py-2 text-right tabular-nums">{e.hours.toLocaleString("en-AU")}</td>
                    <td className="py-2 text-right tabular-nums">{formatCents(e.rateCents)}/hr</td>
                    <td className="py-2 text-right tabular-nums">{formatCents(e.amountCents)}</td>
                    {isBuilder && (
                      <td className="py-2 text-right">
                        <form action={deleteClaimLabour.bind(null, projectId, claimId, e.id)}>
                          <button type="submit" className="text-xs text-red-700 hover:text-red-500 dark:text-red-300">✕</button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-stone-200 font-semibold">
                <tr>
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right tabular-nums">{labourHoursTotal.toLocaleString("en-AU")}</td>
                  <td className="py-2" />
                  <td className="py-2 text-right tabular-nums">{formatCents(labourAmountTotal)}</td>
                  {isBuilder && <td />}
                </tr>
              </tfoot>
            </table>
          )}
          {isBuilder && (
            <form action={addClaimLabour.bind(null, projectId, claimId)} className="mt-3 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
              <div className="grow">
                <label className="label">Role</label>
                <input name="role" required className="input" placeholder="e.g. Site supervisor" />
              </div>
              <div>
                <label className="label">Hours</label>
                <input name="hours" type="number" step="0.25" className="input !w-24" placeholder="0" />
              </div>
              <div>
                <label className="label">Rate $/hr</label>
                <input name="rate" type="number" step="0.01" className="input !w-28" placeholder="0.00" />
              </div>
              <button className="btn-ghost" type="submit">Add</button>
            </form>
          )}
          {labourEntries.length > 0 && Math.abs(labourAmountTotal - claim.labourCents) > 1 && isBuilder && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              ⚠ Breakdown ({formatCents(labourAmountTotal)}) doesn&apos;t match the claim&apos;s labour figure ({formatCents(claim.labourCents)}).
            </p>
          )}
        </details>
      )}

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

      {/* The reconciliation sheet a claim was built from, downloadable by any
          reviewer on an issued claim (Jake §5) — the claim already cites it, so
          let a QS actually open it. */}
      {!isDraft && reconUrl && (
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-stone-400">Supporting document</p>
          <a href={reconUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-brand underline">
            📎 {claim.reconSheetName ?? "Reconciliation sheet"}
          </a>
        </div>
      )}

      {/* Manual claims don't carry sheet figures, but GST must still show as
          its own line rather than a blanket "amounts include GST" (Jake §5). */}
      {!fromSheet && claim.lines.length > 0 && (
        <div className="card max-w-md">
          <p className="mb-2 text-xs uppercase tracking-wide text-stone-400">Claim summary</p>
          <table className="w-full text-sm">
            <tbody>
              {summary.map((s) => (
                <tr key={s.label} className={s.strong ? "font-semibold" : ""}>
                  <td className="py-1.5 text-stone-600">{s.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCents(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
