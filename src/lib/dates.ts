// ─────────────────────────────────────────────────────────────
// ONE date convention across the whole portal (Jake §6).
// Australian, day-first. Never US month-first, never mixed
// "12.07.26" style. Use these helpers — don't hand-roll a
// toLocaleDateString() call at a call site.
// ─────────────────────────────────────────────────────────────

const AU = "en-AU";

/** "14 July 2026" — the default for anything client-facing. */
export function fmtDate(d: Date | null | undefined): string {
  return d ? new Intl.DateTimeFormat(AU, { dateStyle: "long" }).format(d) : "—";
}

/** "14 Jul 2026" — compact, for tables and lists. */
export function fmtDateShort(d: Date | null | undefined): string {
  return d ? new Intl.DateTimeFormat(AU, { dateStyle: "medium" }).format(d) : "—";
}

/** "14/07/2026" — numeric, day-first. Never US order. */
export function fmtDateNumeric(d: Date | null | undefined): string {
  return d ? new Intl.DateTimeFormat(AU, { day: "2-digit", month: "2-digit", year: "numeric" }).format(d) : "—";
}

/** "14 July 2026 at 3:42 pm" — for evidence records, where the time matters. */
export function fmtDateTime(d: Date | null | undefined): string {
  return d
    ? new Intl.DateTimeFormat(AU, { dateStyle: "long", timeStyle: "short" }).format(d)
    : "—";
}

/** yyyy-mm-dd for <input type="date"> values (the HTML value format). */
export function toDateInputValue(d: Date | null | undefined): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when a due date has passed (compared by calendar day, not by time). */
export function isOverdue(due: Date | null | undefined, now: Date = new Date()): boolean {
  if (!due) return false;
  const d = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d < n;
}

/** Whole days a due date is overdue by (0 when not overdue). */
export function daysOverdue(due: Date | null | undefined, now: Date = new Date()): number {
  if (!isOverdue(due, now)) return 0;
  const d = new Date(due!.getFullYear(), due!.getMonth(), due!.getDate()).getTime();
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((n - d) / 86_400_000);
}
