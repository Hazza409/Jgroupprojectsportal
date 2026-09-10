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

      {/* Shown to everyone, builder and client alike, and never behind a
          dismiss button: a client reading dates off a programme is exactly the
          person who needs to know they can move. The terms of use say the same
          thing — this is where it is actually read. */}
      <div className="mb-6 rounded-md border border-stone-200 bg-stone-100/50 px-4 py-2 text-sm text-stone-600">
        Dates are indicative and subject to change. The programme is J Group&apos;s best current view of the
        build and is updated as it progresses; it is not a commitment to any date shown, and does not vary
        any date agreed under the building contract.{" "}
        <Link href="/legal/notice" className="underline underline-offset-2">Portal notice</Link>
      </div>

      {isBuilder && (
        <div className="mb-6 space-y-3">
          <ScheduleUploadForm projectId={projectId} />
          <AddTaskForm projectId={projectId} />
        </div>
      )}

      {items.length === 0 ? (
        <div className="card text-stone-500">No schedule yet. Import an Excel programme or add tasks manually.</div>
      ) : (
        <ScheduleView items={items} projectName={project.name} projectId={projectId} isBuilder={isBuilder} />
      )}
    </div>
  );
}
