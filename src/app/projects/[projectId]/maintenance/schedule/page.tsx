import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { createMaintenanceItem, deleteMaintenanceItem } from "../actions";

const fmtDate = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(d) : "—");

export default async function MaintenanceSchedulePage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const items = await db.maintenanceScheduleItem.findMany({
    where: { projectId },
    orderBy: [{ nextDueDate: "asc" }, { title: "asc" }],
  });

  return (
    <div>
      <Link href={`/projects/${projectId}/maintenance`} className="text-sm text-stone-500 hover:text-ink">← Maintenance</Link>
      <div className="mt-2">
        <ModuleHeader title="Maintenance Schedule" description="Recurring and scheduled maintenance. Items with a due date appear on the shared calendar." />
      </div>

      {isBuilder && (
        <form action={createMaintenanceItem.bind(null, projectId)} className="card mb-6 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Task</label>
            <input name="title" className="input" required placeholder="e.g. Service HVAC system" />
          </div>
          <div>
            <label className="label">Frequency</label>
            <input name="frequency" className="input" placeholder="e.g. Every 6 months" />
          </div>
          <div>
            <label className="label">Next due</label>
            <input name="nextDueDate" type="date" className="input" />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <input name="description" className="input" />
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">Add maintenance item</button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <div className="card text-stone-500">No maintenance items yet.</div>
      ) : (
        <div className="card p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3">Next due</th>
                {isBuilder && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2">
                    {i.title}
                    {i.description && <span className="block text-xs text-stone-400">{i.description}</span>}
                  </td>
                  <td className="px-4 py-2 text-stone-500">{i.frequency ?? "—"}</td>
                  <td className="px-4 py-2">{fmtDate(i.nextDueDate)}</td>
                  {isBuilder && (
                    <td className="px-4 py-2 text-right">
                      <form action={deleteMaintenanceItem.bind(null, projectId, i.id)}>
                        <button className="text-xs text-red-300 hover:text-red-200" type="submit">Delete</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
