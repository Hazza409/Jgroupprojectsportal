import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { PrintButton } from "./PrintButton";

const fmtDate = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("en-AU", { dateStyle: "long" }).format(d) : "—";

// Standalone, light-themed, branded progress-claim document for forwarding to
// the client (Save as PDF from the browser print dialog). Outside the dark
// dashboard chrome; project access is enforced here directly.
export default async function ClaimPrintPage({ params }: { params: { claimId: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const claim = await db.progressClaim.findUnique({
    where: { id: params.claimId },
    include: {
      project: true,
      lines: { orderBy: { id: "asc" } },
    },
  });
  if (!claim) notFound();
  if (!(await canAccessProject(user, claim.projectId))) notFound();

  const summary = [
    { label: "Labour this period", value: claim.labourCents },
    { label: "Costs this period", value: claim.costsCents },
    { label: `Builder's margin (${claim.marginPercent}%)`, value: claim.marginCents },
    { label: "Subtotal (ex-GST)", value: claim.subtotalCents, strong: true },
    { label: "GST", value: claim.gstCents },
    { label: "Total claimed (inc GST)", value: claim.totalCents, strong: true },
  ];

  return (
    <div className="min-h-screen bg-neutral-200 py-8 text-black print:bg-white print:py-0">
      {/* Force a clean white sheet regardless of the app's dark theme. */}
      <style>{`@media print { @page { margin: 16mm; } body { background: #fff !important; } }`}</style>

      <div className="mx-auto max-w-[820px] bg-white p-10 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <div className="mb-6 flex items-center justify-between print:hidden">
          <span className="text-sm text-neutral-500">Progress claim — preview</span>
          <PrintButton />
        </div>

        {/* Brand header */}
        <header className="flex items-start justify-between border-b border-neutral-300 pb-5">
          <div>
            <div className="font-display text-xl font-light tracking-tight">J Group Projects</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-neutral-400">One Of One</div>
          </div>
          <div className="text-right">
            <div className="font-display text-lg font-light">Progress Claim #{claim.claimNumber}</div>
            {claim.periodLabel && <div className="text-sm text-neutral-500">{claim.periodLabel}</div>}
          </div>
        </header>

        {/* Job + claim meta */}
        <section className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-400">Project</div>
            <div className="mt-1 font-medium">{claim.project.name}</div>
            <div className="text-neutral-500">{claim.project.address ?? ""}</div>
            {claim.project.clientName && <div className="text-neutral-500">Client: {claim.project.clientName}</div>}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-neutral-400">Details</div>
            <div className="mt-1">Date: {fmtDate(claim.periodEnd)}</div>
            {claim.reconInvoiceRef && <div className="text-neutral-500">{claim.reconInvoiceRef}</div>}
            <div className="text-neutral-500">Status: {claim.status}</div>
          </div>
        </section>

        {/* Works this period */}
        {claim.narrative && (
          <section className="mt-6">
            <h2 className="text-xs uppercase tracking-wide text-neutral-400">Works this period</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{claim.narrative}</p>
          </section>
        )}

        {/* Budget overview */}
        {claim.lines.length > 0 && (
          <section className="mt-6">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-300 text-left text-xs uppercase tracking-wide text-neutral-400">
                  <th className="py-2">Cost code</th>
                  <th className="py-2 text-right">This period</th>
                  <th className="py-2 text-right">Prior</th>
                  <th className="py-2 text-right">To date</th>
                </tr>
              </thead>
              <tbody>
                {claim.lines.map((l) => (
                  <tr key={l.id} className="border-b border-neutral-100">
                    <td className="py-1.5">{l.description}</td>
                    <td className="py-1.5 text-right tabular-nums">{l.claimedAmountCents ? formatCents(l.claimedAmountCents) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-neutral-500">{formatCents(l.priorCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatCents(l.toDateCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Claim summary */}
        <section className="mt-6 flex justify-end">
          <dl className="w-72 space-y-1.5 text-sm">
            {summary.map((s) => (
              <div
                key={s.label}
                className={`flex items-center justify-between ${s.strong ? "border-t border-neutral-300 pt-1.5 font-semibold" : ""}`}
              >
                <dt className={s.strong ? "" : "text-neutral-500"}>{s.label}</dt>
                <dd className="tabular-nums">{formatCents(s.value)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className="mt-10 border-t border-neutral-200 pt-4 text-[10px] uppercase tracking-[0.2em] text-neutral-400">
          J Group Projects · Design · Construction · Landscape
        </footer>
      </div>
    </div>
  );
}
