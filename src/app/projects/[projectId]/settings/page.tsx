import { redirect } from "next/navigation";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { ClientAccessCard } from "@/components/ClientAccessCard";
import { getCompany, companyShortName } from "@/lib/company";

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

  return (
    <div className="space-y-6">
      <ModuleHeader title="Settings" description={`Project administration. Visible to ${companyShortName(company)} staff only.`} />
      <ClientAccessCard projectId={projectId} clients={clientMembers} />
    </div>
  );
}
