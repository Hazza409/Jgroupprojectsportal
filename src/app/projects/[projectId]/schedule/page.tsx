import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { ScheduleGantt } from "@/components/ScheduleGantt";
import { ScheduleUploadForm } from "./ScheduleUploadForm";
import { AddTaskForm } from "./AddTaskForm";

export default async function SchedulePage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const items = await db.scheduleItem.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div>
      <ModuleHeader
        title="Schedule"
        description={
          isBuilder
            ? "Construction programme — fortnightly updated. Import from Excel or add tasks manually."
            : "Construction programme — updated fortnightly by J Group."
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
        <ScheduleGantt items={items} />
      )}
    </div>
  );
}
