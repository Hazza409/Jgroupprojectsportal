import * as XLSX from "xlsx";

// ── Expected schedule spreadsheet format ─────────────────────
// First worksheet. Recognised headers (case-insensitive):
//
//   Task | Start | Finish | % Complete
//
// See examples/sample-schedule.xlsx. Dates are read as Excel date serials or
// strings; % complete is clamped to 0–100. Same parser pattern as the estimate.

export interface ParsedScheduleItem {
  taskName: string;
  startDate: Date | null;
  endDate: Date | null;
  percentComplete: number;
  sortOrder: number;
}

export interface ParsedSchedule {
  items: ParsedScheduleItem[];
  warnings: string[];
}

const ALIASES = {
  task: ["task", "task name", "activity", "description", "item"],
  start: ["start", "start date", "begin"],
  finish: ["finish", "end", "end date", "finish date", "complete by"],
  percent: ["% complete", "percent complete", "progress", "% done", "complete"],
};

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
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseScheduleBuffer(buf: Buffer): ParsedSchedule {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { items: [], warnings: ["No worksheet found"] };

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });

  let headerRow = -1;
  const map: { task?: number; start?: number; finish?: number; percent?: number } = {};
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = rows[r].map(normalise);
    const task = cells.findIndex((c) => ALIASES.task.includes(c));
    if (task >= 0) {
      map.task = task;
      map.start = cells.findIndex((c) => ALIASES.start.includes(c));
      map.finish = cells.findIndex((c) => ALIASES.finish.includes(c));
      map.percent = cells.findIndex((c) => ALIASES.percent.includes(c));
      headerRow = r;
      break;
    }
  }

  if (headerRow < 0) {
    return { items: [], warnings: ["Could not find a header row (expected: Task, Start, Finish, % Complete)."] };
  }

  const items: ParsedScheduleItem[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const taskName = String(row[map.task!] ?? "").trim();
    if (!taskName) continue;

    let pct = Number(map.percent! >= 0 ? row[map.percent!] : 0) || 0;
    if (pct > 0 && pct <= 1) pct = pct * 100; // accept 0.5 meaning 50%
    pct = Math.max(0, Math.min(100, pct));

    items.push({
      taskName,
      startDate: map.start! >= 0 ? toDate(row[map.start!]) : null,
      endDate: map.finish! >= 0 ? toDate(row[map.finish!]) : null,
      percentComplete: pct,
      sortOrder: items.length,
    });
  }

  return {
    items,
    warnings: items.length === 0 ? ["Header found but no data rows parsed."] : [],
  };
}
