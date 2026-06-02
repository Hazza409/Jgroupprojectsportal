import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { ScheduleUploadForm } from "./ScheduleUploadForm";

function fmt(d: Date | null) {
  return d ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(d) : "—";
}

export default async function SchedulePage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;

  const items = await db.scheduleItem.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div>
      <ModuleHeader title="Schedule" description="Fortnightly project schedule, imported from Excel." />

      {user.role === "BUILDER" && (
        <div className="mb-6">
          <ScheduleUploadForm projectId={projectId} />
        </div>
      )}

      {items.length === 0 ? (
        <div className="card text-stone-500">No schedule imported yet.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">Finish</th>
                <th className="px-4 py-3 text-right">% complete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2">{i.taskName}</td>
                  <td className="px-4 py-2">{fmt(i.startDate)}</td>
                  <td className="px-4 py-2">{fmt(i.endDate)}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-1.5 w-20 overflow-hidden rounded bg-stone-100">
                        <span className="block h-full bg-brand" style={{ width: `${i.percentComplete}%` }} />
                      </span>
                      {Math.round(i.percentComplete)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
