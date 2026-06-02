import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";

const fmt = (d: Date) => new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(d);

const KIND: Record<string, { label: string; cls: string }> = {
  MAINTENANCE: { label: "Maintenance", cls: "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30" },
  BOOKING: { label: "Booking", cls: "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30" },
};

// Maintenance calendar — fed by the maintenance schedule and service bookings.
// Separate from the build (site-meeting) calendar; same underlying event model.
export default async function MaintenanceCalendarPage({ params }: { params: { projectId: string } }) {
  await assertProjectAccess(params.projectId);
  const projectId = params.projectId;

  const events = await db.calendarEvent.findMany({
    where: { projectId, kind: { in: ["MAINTENANCE", "BOOKING"] } },
    orderBy: { startsAt: "asc" },
    include: { createdBy: { select: { name: true } } },
  });
  const now = Date.now();
  const upcoming = events.filter((e) => e.endsAt.getTime() >= now);
  const past = events.filter((e) => e.endsAt.getTime() < now);

  return (
    <div>
      <Link href={`/projects/${projectId}/maintenance`} className="text-sm text-stone-500 hover:text-ink">← Maintenance</Link>
      <div className="mt-2">
        <ModuleHeader
          title="Maintenance Calendar"
          description="Scheduled maintenance and service bookings. Add items via Maintenance Schedule or Service & Bookings."
        />
      </div>

      {events.length === 0 ? (
        <div className="card text-stone-500">Nothing scheduled. Add a maintenance item or schedule a booking.</div>
      ) : (
        <div className="space-y-6">
          {[{ label: "Upcoming", list: upcoming }, { label: "Past", list: past }].map(
            (group) =>
              group.list.length > 0 && (
                <div key={group.label}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">{group.label}</h3>
                  <div className="space-y-2">
                    {group.list.map((e) => (
                      <div key={e.id} className="card">
                        <p className="flex items-center gap-2 font-medium">
                          {e.title}
                          <span className={`badge ${KIND[e.kind]?.cls ?? ""}`}>{KIND[e.kind]?.label ?? e.kind}</span>
                        </p>
                        <p className="text-sm text-stone-500">{fmt(e.startsAt)} → {fmt(e.endsAt)}{e.location ? ` · ${e.location}` : ""}</p>
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
