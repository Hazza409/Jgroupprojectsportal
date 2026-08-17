import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { ScheduleView } from "@/components/ScheduleView";
import { ScheduleUploadForm } from "./ScheduleUploadForm";
import { AddTaskForm } from "./AddTaskForm";
import { getCompany, companyShortName } from "@/lib/company";

export default async function SchedulePage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  const [items, project] = await Promise.all([
    db.scheduleItem.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    db.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
  ]);

  return (
    <div>
      <ModuleHeader
        title="Schedule"
        description={
          isBuilder
            ? "Construction programme — fortnightly updated. Import from Excel or add tasks manually."
            : `Construction programme — updated fortnightly by ${companyShortName(company)}.`
        }
        action={
          isBuilder ? (
            <Link href={`/api/templates/schedule`} className="btn-ghost">Blank template</Link>
          ) : null
        }
      />

      {isBuilder && (
        <div className="mb-6 space-y-3">
          <ScheduleUploadForm projectId={projectId} />
          <AddTaskForm projectId={projectId} />
        </div>
      )}

      {items.length === 0 ? (
        <div className="card text-stone-500">No schedule yet. Import an Excel programme or add tasks manually.</div>
      ) : (
        <ScheduleView items={items} projectName={project.name} />
      )}
    </div>
  );
}
