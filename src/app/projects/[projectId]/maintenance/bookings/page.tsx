import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { createBooking, scheduleBooking, setBookingStatus } from "../actions";

const fmtDateTime = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(d) : null;

export default async function BookingsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const bookings = await db.serviceBooking.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });

  return (
    <div>
      <Link href={`/projects/${projectId}/maintenance`} className="text-sm text-stone-500 hover:text-ink">← Maintenance</Link>
      <div className="mt-2">
        <ModuleHeader
          title="Service & Bookings"
          description={isBuilder ? "Schedule and manage service visits requested by the client." : "Request a service visit; J Group will schedule it."}
        />
      </div>

      {/* Anyone on the project can request a service. */}
      <form action={createBooking.bind(null, projectId)} className="card mb-6 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">What do you need?</label>
          <input name="title" className="input" required placeholder="e.g. Leaking tap in ensuite" />
        </div>
        <div>
          <label className="label">Details (optional)</label>
          <input name="description" className="input" />
        </div>
        <div className="sm:col-span-2">
          <button className="btn-primary" type="submit">{isBuilder ? "Add booking" : "Request service"}</button>
        </div>
      </form>

      {bookings.length === 0 ? (
        <div className="card text-stone-500">No service requests yet.</div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <div key={b.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{b.title}</p>
                  {b.description && <p className="text-sm text-stone-500">{b.description}</p>}
                  {b.scheduledAt && <p className="mt-1 text-xs text-stone-400">Scheduled: {fmtDateTime(b.scheduledAt)}</p>}
                </div>
                <StatusBadge status={b.status} />
              </div>

              {isBuilder && b.status !== "CANCELLED" && b.status !== "COMPLETED" && (
                <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-stone-100 pt-3">
                  <form action={scheduleBooking.bind(null, projectId, b.id)} className="flex items-end gap-2">
                    <div>
                      <label className="label">Schedule for</label>
                      <input name="scheduledAt" type="datetime-local" required className="input" />
                    </div>
                    <button className="btn-ghost" type="submit">{b.status === "SCHEDULED" ? "Reschedule" : "Schedule"}</button>
                  </form>
                  <form action={setBookingStatus.bind(null, projectId, b.id, "COMPLETED")}>
                    <button className="btn-ghost" type="submit">Mark complete</button>
                  </form>
                  <form action={setBookingStatus.bind(null, projectId, b.id, "CANCELLED")}>
                    <button className="text-xs text-red-700 dark:text-red-300 hover:text-red-200" type="submit">Cancel</button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
