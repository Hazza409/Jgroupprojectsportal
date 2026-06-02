const STYLES: Record<string, string> = {
  DRAFT: "bg-stone-100 text-stone-600",
  SUBMITTED: "bg-amber-100 text-amber-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  ACTIVE: "bg-green-100 text-green-800",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STYLES[status] ?? "bg-stone-100 text-stone-600"}`}>{status}</span>;
}
