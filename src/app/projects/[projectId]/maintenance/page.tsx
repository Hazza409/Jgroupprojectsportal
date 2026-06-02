import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";

// Maintenance hub — schedule, bookings, quote requests, and the shared calendar.
export default async function MaintenanceHub({ params }: { params: { projectId: string } }) {
  await assertProjectAccess(params.projectId);
  const projectId = params.projectId;

  const [items, openBookings, openQuotes] = await Promise.all([
    db.maintenanceScheduleItem.count({ where: { projectId } }),
    db.serviceBooking.count({ where: { projectId, status: { in: ["REQUESTED", "SCHEDULED"] } } }),
    db.quoteRequest.count({ where: { projectId, status: { in: ["OPEN", "QUOTED"] } } }),
  ]);

  const cards = [
    { href: "maintenance/schedule", label: "Maintenance Schedule", desc: "Recurring & scheduled maintenance.", count: items },
    { href: "maintenance/bookings", label: "Service & Bookings", desc: "Request and manage service visits.", count: openBookings },
    { href: "maintenance/quotes", label: "Quote Requests", desc: "Raise and respond to quote requests.", count: openQuotes },
    { href: "calendar", label: "Calendar", desc: "Shared calendar — meetings, maintenance & bookings.", count: null as number | null },
  ];

  return (
    <div>
      <ModuleHeader title="Maintenance" description="Ongoing maintenance, service bookings and quotes." />
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.href} href={`/projects/${projectId}/${c.href}`} className="card hover:shadow-md">
            <div className="flex items-start justify-between">
              <h3 className="font-medium">{c.label}</h3>
              {c.count !== null && <span className="badge bg-stone-100 text-stone-600 ring-1 ring-stone-200">{c.count}</span>}
            </div>
            <p className="mt-1 text-sm text-stone-500">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
