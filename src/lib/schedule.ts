// ─────────────────────────────────────────────────────────────
// Programme helpers shared by the schedule list and timeline.
//
// The imported Excel is a real construction programme, which brings two
// readability problems the raw rows can't solve on their own:
//   1. Every task is prefixed with the project name ("8 Fisher Avenue - LGF
//      Slab"), which is already the page masthead — pure noise, and it's what
//      pushes names into truncation.
//   2. Summary rows repeat as both a task AND the next group heading, so the
//      same title appears twice in a row looking like a duplicate.
// Both are handled here so every view benefits.
// ─────────────────────────────────────────────────────────────

export interface ScheduleItemLike {
  id: string;
  group: string | null;
  taskName: string;
  startDate: Date | null;
  endDate: Date | null;
  durationDays: number;
  percentComplete: number;
}

export type TaskStatus = "complete" | "overdue" | "in-progress" | "upcoming" | "not-started";

export interface PreparedTask extends ScheduleItemLike {
  /** Task name with the redundant project prefix removed. */
  label: string;
  status: TaskStatus;
  /** A single-day task — drawn as a diamond, not a bar. */
  isMilestone: boolean;
}

export interface PreparedPhase {
  name: string;
  tasks: PreparedTask[];
  start: Date | null;
  end: Date | null;
  /** Mean progress across the phase, weighted by nothing — simple and honest. */
  percentComplete: number;
}

const DAY = 86_400_000;

function midnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Strip a leading project-name prefix ("8 Fisher Avenue - Slab" → "Slab"). */
export function stripProjectPrefix(name: string, projectName: string): string {
  const n = name.trim();
  const p = projectName.trim();
  if (!p) return n;
  // Match "<project><sep>rest" where sep is - – — : or |, with optional spaces.
  const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–—:|]\\s*`, "i");
  const stripped = n.replace(re, "").trim();
  return stripped.length > 0 ? stripped : n;
}

export function taskStatus(item: ScheduleItemLike, now: Date = new Date()): TaskStatus {
  const pct = item.percentComplete;
  if (pct >= 100) return "complete";
  const today = midnight(now);
  const end = item.endDate ? midnight(new Date(item.endDate)) : null;
  const start = item.startDate ? midnight(new Date(item.startDate)) : null;
  if (end !== null && end < today) return "overdue"; // past its finish, not complete
  if (pct > 0) return "in-progress";
  if (start !== null && start <= today) return "in-progress"; // started by date
  return "upcoming";
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  complete: "Complete",
  overdue: "Overdue",
  "in-progress": "In progress",
  upcoming: "Upcoming",
  "not-started": "Not started",
};

/** Tailwind classes per status — one palette for both views. */
export const STATUS_STYLE: Record<TaskStatus, { bar: string; chip: string }> = {
  complete: { bar: "bg-emerald-500", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  overdue: { bar: "bg-red-500", chip: "bg-red-500/15 text-red-700 dark:text-red-300" },
  "in-progress": { bar: "bg-brand", chip: "bg-brand/15 text-brand" },
  upcoming: { bar: "bg-stone-400", chip: "bg-stone-500/15 text-stone-500" },
  "not-started": { bar: "bg-stone-400", chip: "bg-stone-500/15 text-stone-500" },
};

/**
 * Turn raw schedule rows into phases of prepared tasks.
 * Drops summary rows whose name just repeats the phase heading.
 */
export function preparePhases(items: ScheduleItemLike[], projectName: string, now: Date = new Date()): PreparedPhase[] {
  const phases: PreparedPhase[] = [];

  // Exported programmes flatten a work-breakdown structure, so a PARENT row
  // appears as a task AND again as the heading for its own children:
  //   group "Penklis House"          task "8 Fisher Avenue"        (whole-job duration)
  //   group "8 Fisher Avenue"        task "Key Project Milestones" (whole-job duration)
  //   group "Key Project Milestones" task "Tender Submission Date" (real work)
  // Any task whose name is also used as a group heading is one of those parent
  // rows — the heading already represents it, so drop the duplicate. Matching
  // only against the row's OWN group misses every level but the last.
  const groupNames = new Set(
    items
      .map((i) => (i.group ?? "").trim().toLowerCase())
      .filter(Boolean),
  );

  for (const it of items) {
    const phaseName = (it.group ?? "General").trim();
    const label = stripProjectPrefix(it.taskName, projectName);
    const key = label.trim().toLowerCase();

    const isSummaryEcho =
      key === phaseName.toLowerCase() || // restates its own heading
      groupNames.has(key) || // is a heading elsewhere = parent summary row
      key === projectName.trim().toLowerCase(); // the project itself as a row

    let phase = phases[phases.length - 1];
    if (!phase || phase.name !== phaseName) {
      phase = { name: phaseName, tasks: [], start: null, end: null, percentComplete: 0 };
      phases.push(phase);
    }
    if (isSummaryEcho) continue;

    const start = it.startDate ? new Date(it.startDate) : null;
    const end = it.endDate ? new Date(it.endDate) : null;
    const isMilestone =
      it.durationDays <= 1 && (!start || !end || Math.abs(midnight(end) - midnight(start)) < DAY);

    phase.tasks.push({ ...it, label, status: taskStatus(it, now), isMilestone });
  }

  // Phase roll-ups.
  for (const p of phases) {
    const starts = p.tasks.map((t) => t.startDate).filter(Boolean) as Date[];
    const ends = p.tasks.map((t) => t.endDate).filter(Boolean) as Date[];
    p.start = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
    p.end = ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
    p.percentComplete = p.tasks.length
      ? p.tasks.reduce((a, t) => a + t.percentComplete, 0) / p.tasks.length
      : 0;
  }

  // Drop phases left empty after removing echo rows.
  return phases.filter((p) => p.tasks.length > 0);
}

export interface ScheduleSummary {
  start: Date | null;
  end: Date | null;
  total: number;
  complete: number;
  inProgress: number;
  overdue: number;
  upcoming: number;
  percentComplete: number;
}

export function summarise(phases: PreparedPhase[]): ScheduleSummary {
  const tasks = phases.flatMap((p) => p.tasks);
  const starts = tasks.map((t) => t.startDate).filter(Boolean) as Date[];
  const ends = tasks.map((t) => t.endDate).filter(Boolean) as Date[];
  return {
    start: starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null,
    end: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
    total: tasks.length,
    complete: tasks.filter((t) => t.status === "complete").length,
    inProgress: tasks.filter((t) => t.status === "in-progress").length,
    overdue: tasks.filter((t) => t.status === "overdue").length,
    upcoming: tasks.filter((t) => t.status === "upcoming").length,
    percentComplete: tasks.length ? tasks.reduce((a, t) => a + t.percentComplete, 0) / tasks.length : 0,
  };
}

/** Tasks running now or starting within `days` — "what's happening" for a client. */
export function currentAndNext(phases: PreparedPhase[], days = 30, now: Date = new Date()): PreparedTask[] {
  const today = midnight(now);
  const horizon = today + days * DAY;
  return phases
    .flatMap((p) => p.tasks)
    .filter((t) => {
      if (t.status === "complete") return false;
      const s = t.startDate ? midnight(new Date(t.startDate)) : null;
      const e = t.endDate ? midnight(new Date(t.endDate)) : null;
      if (t.status === "overdue") return true;
      if (s !== null && s <= horizon && (e === null || e >= today)) return true;
      return false;
    })
    .sort((a, b) => {
      const as = a.startDate ? new Date(a.startDate).getTime() : 0;
      const bs = b.startDate ? new Date(b.startDate).getTime() : 0;
      return as - bs;
    });
}
