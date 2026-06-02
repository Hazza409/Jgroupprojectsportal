import Link from "next/link";
import { notFound } from "next/navigation";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { formatCents, sumCents } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { ClaimLineForm } from "./ClaimLineForm";
import { ReconUploadForm } from "./ReconUploadForm";
import { NarrativeForm } from "./NarrativeForm";
import { generateClaimLines, deleteClaimLine, submitClaim, decideClaim } from "../actions";

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
  const reconUrl = claim.reconSheetKey ? await (await storage()).url(claim.reconSheetKey) : null;

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
            <Link href={`/projects/${projectId}/progress-claims/${claimId}/print`} target="_blank" className="btn-ghost">
              View / PDF
            </Link>
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

      {/* Last two weeks */}
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Last two weeks</h3>
        {isBuilder ? (
          <NarrativeForm projectId={projectId} claimId={claimId} initial={claim.narrative ?? ""} />
        ) : claim.narrative ? (
          <p className="whitespace-pre-wrap text-sm text-stone-300">{claim.narrative}</p>
        ) : (
          <p className="text-sm text-stone-500">No update provided for this period.</p>
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
                        <button className="text-xs text-red-300 hover:text-red-200" type="submit">Remove</button>
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
