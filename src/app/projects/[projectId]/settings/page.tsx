import { redirect } from "next/navigation";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { ClientAccessCard } from "@/components/ClientAccessCard";
import { ForecastCard } from "@/components/ForecastCard";
import { ClientActivityCard } from "@/components/ClientActivityCard";
import { JobDetailsCard } from "@/components/JobDetailsCard";
import { getCompany, companyShortName } from "@/lib/company";
import { fmtDate, fmtDateTime, toDateInputValue } from "@/lib/dates";
import { forecastGate } from "@/lib/forecast";
import { formatCents, centsToNumber } from "@/lib/money";

// Project settings — builder only. Home for client access + project administration.
export default async function ProjectSettingsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  if (user.role !== "BUILDER") redirect(`/projects/${params.projectId}`);
  const projectId = params.projectId;
  const company = await getCompany();

  const clientMembers = (
    await db.projectMembership.findMany({
      where: { projectId, user: { role: "CLIENT" } },
      include: { user: { select: { id: true, email: true, name: true } } },
    })
  ).map((m) => m.user);

  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      name: true,
      address: true,
      contractValueCents: true,
      forecastFinalCostCents: true,
      forecastCompletionDate: true,
      forecastUpdatedAt: true,
      forecastUpdatedBy: true,
      pendingForecastFinalCostCents: true,
      pendingForecastCompletionDate: true,
      pendingForecastFinalCostNote: true,
      pendingForecastCompletionNote: true,
    },
  });
  const gate = await forecastGate(projectId, company);

  const publishedBits = [
    project.forecastFinalCostCents != null ? formatCents(project.forecastFinalCostCents) : null,
    project.forecastCompletionDate ? `completion ${fmtDate(project.forecastCompletionDate)}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <ModuleHeader title="Settings" description={`Project administration. Visible to ${companyShortName(company)} staff only.`} />
      <JobDetailsCard
        projectId={projectId}
        name={project.name}
        address={project.address}
        contractDollars={(centsToNumber(project.contractValueCents) / 100).toFixed(2)}
      />
      <ForecastCard
        projectId={projectId}
        pendingCostDollars={project.pendingForecastFinalCostCents != null ? (centsToNumber(project.pendingForecastFinalCostCents) / 100).toFixed(2) : ""}
        pendingDate={toDateInputValue(project.pendingForecastCompletionDate)}
        pendingCostNote={project.pendingForecastFinalCostNote ?? ""}
        pendingDateNote={project.pendingForecastCompletionNote ?? ""}
        publishedSummary={publishedBits.length ? publishedBits.join(" · ") : null}
        publishedAt={project.forecastUpdatedAt ? fmtDateTime(project.forecastUpdatedAt) : null}
        publishedBy={project.forecastUpdatedBy}
        gate={{
          required: gate.required,
          signed: gate.signed.map((s) => ({ email: s.email, name: s.name, at: fmtDateTime(s.at) })),
          outstanding: gate.outstanding,
          complete: gate.complete,
          hasPending: gate.hasPending,
          warning: gate.warning,
          unconfigured: gate.unconfigured,
          unmatched: gate.unmatched,
        }}
        canSign={gate.unconfigured || gate.required.includes(user.email.toLowerCase())}
      />
      <ClientAccessCard projectId={projectId} clients={clientMembers} />
      <ClientActivityCard projectId={projectId} />
    </div>
  );
}
