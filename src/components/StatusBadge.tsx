// Status tints, tuned for dark mode. Functional color is kept (status must read
// at a glance) but desaturated to translucent fills with light text, so it sits
// quietly within the monochrome brand rather than shouting.
const STYLES: Record<string, string> = {
  DRAFT: "bg-stone-100 text-stone-600 ring-1 ring-stone-200",
  SUBMITTED: "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30",
  APPROVED: "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30",
  REJECTED: "bg-red-400/15 text-red-200 ring-1 ring-red-400/30",
  ACTIVE: "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STYLES[status] ?? "bg-stone-100 text-stone-600 ring-1 ring-stone-200"}`}>
      {status}
    </span>
  );
}
