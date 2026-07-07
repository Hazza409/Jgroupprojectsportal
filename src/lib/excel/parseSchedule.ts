import * as XLSX from "xlsx";

// ── Expected schedule spreadsheet format ─────────────────────
// First worksheet. Recognised headers (case-insensitive):
//
//   Phase | Task | Start | Finish | Duration | % Complete
//
// Phase/Duration are optional. See examples/sample-schedule.xlsx. Dates are read
// as Excel date serials or strings; % complete is clamped to 0–100.

export interface ParsedScheduleItem {
  group: string | null;
  taskName: string;
  startDate: Date | null;
  endDate: Date | null;
  durationDays: number;
  percentComplete: number;
  sortOrder: number;
}

export interface ParsedSchedule {
  items: ParsedScheduleItem[];
  warnings: string[];
}

const ALIASES = {
  group: ["phase", "group", "trade", "stage", "section"],
  task: ["task", "task name", "activity", "description", "item"],
  start: ["start", "start date", "begin"],
  finish: ["finish", "end", "end date", "finish date", "complete by"],
  duration: ["duration", "duration (days)", "days", "dur"],
  percent: ["% complete", "percent complete", "progress", "% done", "complete"],
};

function daysBetween(a: Date | null, b: Date | null): number {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function normalise(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    // Excel serial date → JS Date via SheetJS helper.
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
  }
  const str = String(value).trim();
  // Day-first formats (AU): d/m/y or d-m-y. new Date() would read these as US
  // month-first, silently flipping 03/04/2026 (3 Apr) to 4 Mar. Parse explicitly.
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(str);
  if (dmy) {
    let [, dd, mm, yy] = dmy;
    const day = Number(dd), month = Number(mm);
    let year = Number(yy);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(year, month - 1, day));
    }
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseScheduleBuffer(buf: Buffer): ParsedSchedule {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { items: [], warnings: ["No worksheet found"] };

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });

  let headerRow = -1;
  const map: { group?: number; task?: number; start?: number; finish?: number; duration?: number; percent?: number } = {};
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = rows[r].map(normalise);
    const task = cells.findIndex((c) => ALIASES.task.includes(c));
    if (task >= 0) {
      map.task = task;
      map.group = cells.findIndex((c) => ALIASES.group.includes(c));
      map.start = cells.findIndex((c) => ALIASES.start.includes(c));
      map.finish = cells.findIndex((c) => ALIASES.finish.includes(c));
      map.duration = cells.findIndex((c) => ALIASES.duration.includes(c));
      map.percent = cells.findIndex((c) => ALIASES.percent.includes(c));
      headerRow = r;
      break;
    }
  }

  if (headerRow < 0) {
    return { items: [], warnings: ["Could not find a header row (expected: Task, Start, Finish, % Complete)."] };
  }

  const items: ParsedScheduleItem[] = [];
  let lastGroup: string | null = null;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const taskName = String(row[map.task!] ?? "").trim();
    if (!taskName) continue;

    // Accept "50%", "50", or 0.5 — strip a trailing % so text cells don't → 0.
    const pctRaw = map.percent! >= 0 ? row[map.percent!] : 0;
    let pct = Number(String(pctRaw ?? "").replace(/[%\s]/g, "")) || 0;
    if (pct > 0 && pct <= 1) pct = pct * 100; // accept 0.5 meaning 50%
    pct = Math.max(0, Math.min(100, pct));

    // Carry the last non-empty phase down (grouped sheets leave it blank on sub-rows).
    const groupCell = map.group! >= 0 ? String(row[map.group!] ?? "").trim() : "";
    if (groupCell) lastGroup = groupCell;

    const startDate = map.start! >= 0 ? toDate(row[map.start!]) : null;
    const endDate = map.finish! >= 0 ? toDate(row[map.finish!]) : null;
    const durCell = map.duration! >= 0 ? Number(row[map.duration!]) : 0;
    const durationDays = Number.isFinite(durCell) && durCell > 0 ? Math.round(durCell) : daysBetween(startDate, endDate);

    items.push({
      group: lastGroup,
      taskName,
      startDate,
      endDate,
      durationDays,
      percentComplete: pct,
      sortOrder: items.length,
    });
  }

  return {
    items,
    warnings: items.length === 0 ? ["Header found but no data rows parsed."] : [],
  };
}
