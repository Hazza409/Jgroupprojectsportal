import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, sumCents } from "@/lib/money";

// Project overview — headline numbers pulled live from the schema.
export default async function ProjectOverview({ params }: { params: { projectId: string } }) {
  await assertProjectAccess(params.projectId);
  const projectId = params.projectId;

  const [project, estimateLines, actuals, claims, variations, schedule, events, photos] =
    await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: projectId } }),
      db.estimateLineItem.findMany({ where: { projectId }, select: { totalCents: true } }),
      db.costActual.findMany({ where: { projectId }, select: { amountCents: true } }),
      db.progressClaim.count({ where: { projectId } }),
      db.variation.findMany({ where: { projectId, status: "APPROVED" }, select: { totalCents: true } }),
      db.scheduleItem.count({ where: { projectId } }),
      db.calendarEvent.count({ where: { projectId } }),
      db.photo.count({ where: { projectId } }),
    ]);

  const estimateTotal = sumCents(estimateLines.map((l) => l.totalCents));
  const actualsTotal = sumCents(actuals.map((a) => a.amountCents));
  const approvedVariations = sumCents(variations.map((v) => v.totalCents));
  const adjustedContract = project.contractValueCents + approvedVariations;

  const stats = [
    { label: "Original estimate", value: formatCents(estimateTotal) },
    { label: "Contract + approved variations", value: formatCents(adjustedContract) },
    { label: "Actuals to date (Xero)", value: formatCents(actualsTotal) },
    { label: "Approved variations", value: formatCents(approvedVariations) },
  ];

  const links = [
    { href: "estimate", label: "Original Estimate" },
    { href: "cost-to-complete", label: "Cost to Complete" },
    { href: "progress-claims", label: `Progress Claims (${claims})` },
    { href: "schedule", label: `Schedule (${schedule})` },
    { href: "calendar", label: `Calendar (${events})` },
    { href: "photos", label: `Photos (${photos})` },
  ];

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <p className="text-xs uppercase tracking-wide text-stone-400">{s.label}</p>
            <p className="mt-2 text-xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={`/projects/${projectId}/${l.href}`} className="card hover:shadow-md">
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
