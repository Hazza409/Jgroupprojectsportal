import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { createEvent, deleteEvent } from "./actions";

function fmt(d: Date) {
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

const KIND: Record<string, { label: string; cls: string }> = {
  SITE_MEETING: { label: "Meeting", cls: "bg-stone-100 text-stone-600 ring-1 ring-stone-200" },
  MAINTENANCE: { label: "Maintenance", cls: "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30" },
  BOOKING: { label: "Booking", cls: "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30" },
};

export default async function CalendarPage({ params }: { params: { projectId: string } }) {
  await assertProjectAccess(params.projectId);
  const projectId = params.projectId;

  // Build calendar = site meetings only. Maintenance + bookings live on the
  // separate maintenance calendar (/maintenance/calendar).
  const events = await db.calendarEvent.findMany({
    where: { projectId, kind: "SITE_MEETING" },
    orderBy: { startsAt: "asc" },
    include: { createdBy: { select: { name: true } } },
  });

  const now = Date.now();
  const upcoming = events.filter((e) => e.endsAt.getTime() >= now);
  const past = events.filter((e) => e.endsAt.getTime() < now);

  return (
    <div>
      <ModuleHeader title="Calendar" description="Site meetings — editable by both builder and client." />

      <form action={createEvent.bind(null, projectId)} className="card mb-6 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Title</label>
          <input name="title" className="input" required placeholder="Site meeting" />
        </div>
        <div>
          <label className="label">Starts</label>
          <input name="startsAt" type="datetime-local" className="input" required />
        </div>
        <div>
          <label className="label">Ends</label>
          <input name="endsAt" type="datetime-local" className="input" />
        </div>
        <div>
          <label className="label">Location</label>
          <input name="location" className="input" placeholder="On site" />
        </div>
        <div>
          <label className="label">Notes</label>
          <input name="notes" className="input" />
        </div>
        <div className="sm:col-span-2">
          <button className="btn-primary" type="submit">Add meeting</button>
        </div>
      </form>

      {events.length === 0 ? (
        <div className="card text-stone-500">No meetings scheduled.</div>
      ) : (
        <div className="space-y-6">
          {[{ label: "Upcoming", list: upcoming }, { label: "Past", list: past }].map(
            (group) =>
              group.list.length > 0 && (
                <div key={group.label}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
                    {group.label}
                  </h3>
                  <div className="space-y-2">
                    {group.list.map((e) => (
                      <div key={e.id} className="card flex items-center justify-between">
                        <div>
                          <p className="flex items-center gap-2 font-medium">
                            {e.title}
                            <span className={`badge ${KIND[e.kind]?.cls ?? KIND.SITE_MEETING.cls}`}>
                              {KIND[e.kind]?.label ?? e.kind}
                            </span>
                          </p>
                          <p className="text-sm text-stone-500">
                            {fmt(e.startsAt)} → {fmt(e.endsAt)}
                            {e.location ? ` · ${e.location}` : ""}
                          </p>
                          {e.notes && <p className="text-sm text-stone-400">{e.notes}</p>}
                          <p className="mt-1 text-xs text-stone-400">Added by {e.createdBy?.name ?? "—"}</p>
                        </div>
                        <form action={deleteEvent.bind(null, projectId, e.id)}>
                          <button className="text-sm text-red-300 hover:text-red-200" type="submit">
                            Remove
                          </button>
                        </form>
                      </div>
                    ))}
                  </div>
                </div>
              ),
          )}
        </div>
      )}
    </div>
  );
}
