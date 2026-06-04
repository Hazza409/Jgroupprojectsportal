// Status tints, tuned for dark mode. Functional color is kept (status must read
// at a glance) but desaturated to translucent fills with light text, so it sits
// quietly within the monochrome brand rather than shouting.
const STYLES: Record<string, string> = {
  DRAFT: "bg-stone-100 text-stone-600 ring-1 ring-stone-200",
  SUBMITTED: "bg-amber-500/12 dark:bg-amber-400/15 text-amber-700 dark:text-amber-200 ring-1 ring-amber-500/30 dark:ring-amber-400/30",
  APPROVED: "bg-emerald-500/12 dark:bg-emerald-400/15 text-emerald-700 dark:text-emerald-200 ring-1 ring-emerald-500/30 dark:ring-emerald-400/30",
  REJECTED: "bg-red-500/12 dark:bg-red-400/15 text-red-700 dark:text-red-200 ring-1 ring-red-500/30 dark:ring-red-400/30",
  ACTIVE: "bg-emerald-500/12 dark:bg-emerald-400/15 text-emerald-700 dark:text-emerald-200 ring-1 ring-emerald-500/30 dark:ring-emerald-400/30",
  // RFI
  OPEN: "bg-amber-500/12 dark:bg-amber-400/15 text-amber-700 dark:text-amber-200 ring-1 ring-amber-500/30 dark:ring-amber-400/30",
  ANSWERED: "bg-emerald-500/12 dark:bg-emerald-400/15 text-emerald-700 dark:text-emerald-200 ring-1 ring-emerald-500/30 dark:ring-emerald-400/30",
  CLOSED: "bg-stone-100 text-stone-600 ring-1 ring-stone-200",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STYLES[status] ?? "bg-stone-100 text-stone-600 ring-1 ring-stone-200"}`}>
      {status}
    </span>
  );
}
