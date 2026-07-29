import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, sumCents, inclMarginGst } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { computeCostToComplete, projectDrawdown } from "@/lib/claims";
import { logView } from "@/lib/audit";
import { fmtDate } from "@/lib/dates";
import { StatusBadge } from "@/components/StatusBadge";
import { ClientViewControl } from "@/components/ClientViewControl";

// Project overview — headline numbers pulled live from the schema.
export default async function ProjectOverview({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const company = await getCompany();

  const [project, estimateLines, approvedClaims, claims, approvedVars, pendingVars, schedule, events, photos] =
    await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: projectId } }),
      db.estimateLineItem.findMany({ where: { projectId }, select: { totalCents: true } }),
      db.progressClaim.findMany({
        where: { projectId, status: "APPROVED" },
        select: { totalCents: true, lines: { select: { claimedAmountCents: true } } },
      }),
      db.progressClaim.count({ where: { projectId } }),
      db.variation.findMany({ where: { projectId, status: "APPROVED" }, select: { totalCents: true } }),
      db.variation.findMany({
        where: { projectId, status: { in: ["DRAFT", "SUBMITTED"] } },
        orderBy: { variationNumber: "asc" },
        select: { id: true, variationNumber: true, title: true, totalCents: true, status: true },
      }),
      db.scheduleItem.count({ where: { projectId } }),
      db.calendarEvent.count({ where: { projectId } }),
      db.photo.count({ where: { projectId } }),
    ]);

  // Cost to Complete headline figures, surfaced on the overview (same shared
  // computation as the Cost to Complete page, so they always agree).
  const ctc = await computeCostToComplete(projectId, company);

  // Movement in the two headline forecast figures since the last statement.
  const costMovementCents =
    project.forecastFinalCostCents != null && project.forecastFinalCostPrevCents != null
      ? project.forecastFinalCostCents - project.forecastFinalCostPrevCents
      : null;
  const dateMovementDays =
    project.forecastCompletionDate && project.forecastCompletionPrevDate
      ? Math.round(
          (project.forecastCompletionDate.getTime() - project.forecastCompletionPrevDate.getTime()) / 86_400_000,
        )
      : null;

  await logView(projectId, user, `/projects/${projectId}`, "Project overview");

  // ONE source of truth for every figure on this page — the same computations
  // the Cost to Complete page and the claims ledger use, so nothing can differ
  // by a cent (Jake §6). Never re-derive money locally here.
  const drawdown = await projectDrawdown(projectId, company);
  const estimateTotal = ctc.totals.estimateCents;
  const approvedVariations = ctc.totals.variationsCents;
  const claimedTotal = drawdown.drawnCents;
  const budgetBase = drawdown.budgetCents;
  const drawnPct = drawdown.pct;

  const stats = [
    { label: "Original estimate", value: formatCents(estimateTotal) },
    { label: "Estimate + approved variations", value: formatCents(budgetBase) },
    { label: "Invoiced to date (approved claims)", value: formatCents(claimedTotal) },
    { label: "Approved variations", value: formatCents(approvedVariations) },
  ];

  // What this viewer sees. Builders see everything; a client sees either the
  // construction modules or the Handover & Maintenance area per the builder's
  // client-view switch (mirrors the nav + the server-side guard in the layout).
  const isBuilder = user.role === "BUILDER";
  const showConstruction = isBuilder || project.clientView === "CONSTRUCTION";
  const showCare = isBuilder || project.clientView === "HANDOVER";

  const constructionLinks = [
    { href: "estimate", label: "Original Estimate" },
    { href: "cost-to-complete", label: "Cost to Complete" },
    { href: "progress-claims", label: `Progress Claims (${claims})` },
    { href: "variations", label: "Variations" },
    { href: "schedule", label: `Schedule (${schedule})` },
    { href: "calendar", label: `Calendar (${events})` },
    { href: "photos", label: `Photos (${photos})` },
  ];
  const careLinks = [
    { href: "handover", label: "Handover" },
    { href: "maintenance", label: "Maintenance" },
  ];
  const links = [...(showConstruction ? constructionLinks : []), ...(showCare ? careLinks : [])];

  return (
    <div className="space-y-6">
      {isBuilder && <ClientViewControl projectId={projectId} clientView={project.clientView} />}

      {showConstruction && (
      <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-stone-400">
          All amounts include builder&apos;s margin ({company.marginPercent.toFixed(1)}%) and GST ({company.gstPercent.toFixed(0)}%).
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <a className="btn-ghost" href={`/snapshot/${projectId}/print`} target="_blank" rel="noreferrer">PDF snapshot</a>
          <a className="btn-ghost" href={`/api/projects/${projectId}/export`}>Export all to Excel</a>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <p className="text-xs uppercase tracking-wide text-stone-400">{s.label}</p>
            <p className="mt-2 text-xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Drawn-down progress: approved progress claims vs estimate + approved variations. */}
      <div className="card">
        <div className="flex items-end justify-between">
          <p className="text-xs uppercase tracking-wide text-stone-400">
            Budget drawdown · approved progress claims
          </p>
          <p className="text-2xl font-semibold">{drawnPct.toFixed(1)}%</p>
        </div>
        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-stone-100">
          <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, drawnPct)}%` }} />
        </div>
        <p className="mt-2 text-xs text-stone-400">
          {formatCents(claimedTotal)} of {formatCents(budgetBase)} across {approvedClaims.length} approved claim{approvedClaims.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* THE TWO HEADLINE NUMBERS (Jake §3) — the questions the client is
          actually holding. Both are entered by hand from Nick's fortnightly
          figures; the portal never calculates them. */}
      {(project.forecastFinalCostCents != null || project.forecastCompletionDate) && (
        <div className="card border-brand/30">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Forecast</h2>
            {project.forecastUpdatedAt && (
              <span className="text-xs text-stone-400">Confirmed {fmtDate(project.forecastUpdatedAt)}</span>
            )}
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            {project.forecastFinalCostCents != null && (
              <div>
                <p className="text-xs uppercase tracking-wide text-stone-400">Forecast final cost</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">{formatCents(project.forecastFinalCostCents)}</p>
                {costMovementCents !== null && (
                  <p className={`mt-1 text-sm ${costMovementCents > 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                    {costMovementCents > 0 ? "▲" : "▼"} {formatCents(Math.abs(costMovementCents))} since last statement
                  </p>
                )}
                {project.forecastFinalCostNote && (
                  <p className="mt-1 text-sm text-stone-500">{project.forecastFinalCostNote}</p>
                )}
              </div>
            )}
            {project.forecastCompletionDate && (
              <div>
                <p className="text-xs uppercase tracking-wide text-stone-400">Forecast completion</p>
                <p className="mt-1 text-3xl font-semibold">{fmtDate(project.forecastCompletionDate)}</p>
                {dateMovementDays !== null && dateMovementDays !== 0 && (
                  <p className={`mt-1 text-sm ${dateMovementDays > 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                    {dateMovementDays > 0 ? "▲" : "▼"} {Math.abs(dateMovementDays)} day{Math.abs(dateMovementDays) === 1 ? "" : "s"}{" "}
                    {dateMovementDays > 0 ? "later" : "earlier"} than last statement
                  </p>
                )}
                {project.forecastCompletionNote && (
                  <p className="mt-1 text-sm text-stone-500">{project.forecastCompletionNote}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cost to Complete summary — surfaced here so the numbers are on the
          overview without clicking through. Full breakdown on the CTC page. */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Cost to Complete</h2>
          <Link href={`/projects/${projectId}/cost-to-complete`} className="text-sm text-stone-500 hover:text-ink">
            View breakdown →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Current to Date", value: ctc.totals.currentCents },
            { label: "Revised Estimate", value: ctc.totals.revisedCents },
            { label: "Cost to Complete", value: ctc.totals.costToCompleteCents },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-xs uppercase tracking-wide text-stone-400">{s.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatCents(s.value)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pending variations awaiting pricing / client approval. */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Pending variations</h2>
          <Link href={`/projects/${projectId}/variations`} className="text-sm text-stone-500 hover:text-ink">
            View all →
          </Link>
        </div>
        {pendingVars.length === 0 ? (
          <p className="text-sm text-stone-500">No variations awaiting approval.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {pendingVars.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-4 py-2">
                <span className="min-w-0 truncate text-sm">
                  {v.title} <span className="text-stone-400">· #{v.variationNumber}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-sm tabular-nums">
                    {v.totalCents > 0 ? formatCents(inclMarginGst(v.totalCents, company)) : "Being priced"}
                  </span>
                  <StatusBadge status={v.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      </>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={`/projects/${projectId}/${l.href}`} className="card hover:shadow-md">
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
