import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, inclMarginGst } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { computeCostToComplete, projectDrawdown } from "@/lib/claims";
import { PrintButton } from "./PrintButton";

const fmtDate = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-AU", { dateStyle: "long" }).format(d) : "—");

// One-page, standalone, branded snapshot of the project overview — for
// attaching to a claim email (Jake §6.1). Built from the same figures as the
// dashboard so it stays consistent. Lives outside the project layout; enforces
// access + the client-view guard itself.
export default async function SnapshotPage({ params }: { params: { projectId: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { projectId } = params;
  if (!(await canAccessProject(user, projectId))) notFound();
  const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true, address: true, clientName: true, clientView: true } });
  if (!project) notFound();
  if (user.role === "CLIENT" && project.clientView === "HANDOVER") notFound();

  const company = await getCompany();
  const [ctc, drawdown, pendingVars] = await Promise.all([
    computeCostToComplete(projectId, company),
    projectDrawdown(projectId, company),
    db.variation.findMany({
      where: { projectId, status: { in: ["DRAFT", "SUBMITTED"] } },
      orderBy: { variationNumber: "asc" },
      select: { variationNumber: true, title: true, totalCents: true, status: true },
    }),
  ]);

  const figures = [
    { label: "Original estimate", value: ctc.totals.estimateCents },
    { label: "Approved variations", value: ctc.totals.variationsCents },
    { label: "Revised estimate", value: ctc.totals.revisedCents },
    { label: "Invoiced to date", value: drawdown.drawnCents },
    { label: "Current cost to date", value: ctc.totals.currentCents },
    { label: "Cost to complete", value: ctc.totals.costToCompleteCents },
  ];
  const pct = drawdown.budgetCents > 0 ? (drawdown.drawnCents / drawdown.budgetCents) * 100 : 0;

  return (
    <div className="min-h-screen bg-neutral-200 py-8 text-black print:bg-white print:py-0">
      <style>{`@media print { @page { margin: 16mm; } body { background: #fff !important; } }`}</style>

      <div className="mx-auto max-w-[820px] bg-white p-10 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <div className="mb-6 flex items-center justify-between print:hidden">
          <span className="text-sm text-neutral-500">Project snapshot — preview</span>
          <PrintButton />
        </div>

        <header className="flex items-start justify-between border-b border-neutral-300 pb-5">
          <div>
            <div className="font-display text-xl font-light tracking-tight">{company.name}</div>
            {company.tagline && (
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-neutral-400">{company.tagline}</div>
            )}
          </div>
          <div className="text-right">
            <div className="font-display text-lg font-light">Project Snapshot</div>
            <div className="text-sm text-neutral-500">{fmtDate(new Date())}</div>
          </div>
        </header>

        <section className="mt-6 text-sm">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Project</div>
          <div className="mt-1 text-lg font-medium">{project.name}</div>
          <div className="text-neutral-500">{project.address ?? ""}</div>
          {project.clientName && <div className="text-neutral-500">Client: {project.clientName}</div>}
        </section>

        <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {figures.map((f) => (
            <div key={f.label} className="rounded-md border border-neutral-200 p-3">
              <div className="text-xs uppercase tracking-wide text-neutral-400">{f.label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{formatCents(f.value)}</div>
            </div>
          ))}
        </section>

        <section className="mt-6">
          <div className="flex items-end justify-between text-sm">
            <span className="text-xs uppercase tracking-wide text-neutral-400">Invoiced vs budget</span>
            <span className="font-semibold">{pct.toFixed(1)}%</span>
          </div>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full rounded-full bg-neutral-800" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            {formatCents(drawdown.drawnCents)} of {formatCents(drawdown.budgetCents)}
          </div>
        </section>

        {pendingVars.length > 0 && (
          <section className="mt-6">
            <div className="text-xs uppercase tracking-wide text-neutral-400">Pending variations</div>
            <ul className="mt-2 divide-y divide-neutral-200 text-sm">
              {pendingVars.map((v) => (
                <li key={v.variationNumber} className="flex items-center justify-between gap-3 py-1.5">
                  <span>{v.title} <span className="text-neutral-400">· #{v.variationNumber}</span></span>
                  <span className="tabular-nums">{v.totalCents > 0 ? formatCents(inclMarginGst(v.totalCents, company)) : "Being priced"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-8 text-[11px] text-neutral-400">
          All amounts include builder&apos;s margin ({company.marginPercent.toFixed(1)}%) and GST ({company.gstPercent.toFixed(0)}%).
          Figures reflect the approved cost plan and approved variations; forecast final cost is confirmed separately.
        </p>
      </div>
    </div>
  );
}
