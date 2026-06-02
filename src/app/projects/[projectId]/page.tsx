import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, sumCents, inclMarginGst, BUILDERS_MARGIN, GST } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { PhaseControl } from "@/components/PhaseControl";
import { ClientAccessCard } from "@/components/ClientAccessCard";

// Project overview — headline numbers pulled live from the schema.
export default async function ProjectOverview({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;

  const [project, estimateLines, actuals, claims, approvedVars, pendingVars, schedule, events, photos] =
    await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: projectId } }),
      db.estimateLineItem.findMany({ where: { projectId }, select: { totalCents: true } }),
      db.costActual.findMany({ where: { projectId }, select: { amountCents: true } }),
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

  // All figures shown inclusive of builder's margin + GST (matches Cost to Complete).
  const estimateTotal = inclMarginGst(sumCents(estimateLines.map((l) => l.totalCents)));
  const actualsTotal = inclMarginGst(sumCents(actuals.map((a) => a.amountCents)));
  const approvedVariations = inclMarginGst(sumCents(approvedVars.map((v) => v.totalCents)));

  // Drawn down = costs to date as a % of (estimate + approved variations).
  // (Ratio is unaffected by the uniform gross-up.)
  const budgetBase = estimateTotal + approvedVariations;
  const drawnPct = budgetBase > 0 ? (actualsTotal / budgetBase) * 100 : 0;

  const stats = [
    { label: "Original estimate", value: formatCents(estimateTotal) },
    { label: "Estimate + approved variations", value: formatCents(budgetBase) },
    { label: "Drawn down to date", value: formatCents(actualsTotal) },
    { label: "Approved variations", value: formatCents(approvedVariations) },
  ];

  const links = [
    { href: "estimate", label: "Original Estimate" },
    { href: "cost-to-complete", label: "Cost to Complete" },
    { href: "progress-claims", label: `Progress Claims (${claims})` },
    { href: "schedule", label: `Schedule (${schedule})` },
    { href: "calendar", label: `Calendar (${events})` },
    { href: "photos", label: `Photos (${photos})` },
    { href: "handover", label: "Handover" },
    { href: "maintenance", label: "Maintenance" },
  ];

  const clientMembers =
    user.role === "BUILDER"
      ? (
          await db.projectMembership.findMany({
            where: { projectId, user: { role: "CLIENT" } },
            include: { user: { select: { id: true, email: true, name: true } } },
          })
        ).map((m) => m.user)
      : [];

  return (
    <div className="space-y-6">
      {user.role === "BUILDER" && <PhaseControl projectId={projectId} phase={project.phase} />}
      {user.role === "BUILDER" && <ClientAccessCard projectId={projectId} clients={clientMembers} />}

      <p className="text-xs text-stone-400">
        All amounts include builder&apos;s margin ({(BUILDERS_MARGIN * 100).toFixed(1)}%) and GST ({(GST * 100).toFixed(0)}%).
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <p className="text-xs uppercase tracking-wide text-stone-400">{s.label}</p>
            <p className="mt-2 text-xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Drawn-down progress: costs to date vs estimate + approved variations. */}
      <div className="card">
        <div className="flex items-end justify-between">
          <p className="text-xs uppercase tracking-wide text-stone-400">
            Drawn down · estimate + approved variations
          </p>
          <p className="text-2xl font-semibold">{drawnPct.toFixed(1)}%</p>
        </div>
        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-stone-100">
          <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, drawnPct)}%` }} />
        </div>
        <p className="mt-2 text-xs text-stone-400">
          {formatCents(actualsTotal)} of {formatCents(budgetBase)} drawn down
        </p>
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
                  <span className="text-stone-400">VO #{v.variationNumber}</span> · {v.title}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-sm tabular-nums">
                    {v.totalCents > 0 ? formatCents(inclMarginGst(v.totalCents)) : "Being priced"}
                  </span>
                  <StatusBadge status={v.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

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
