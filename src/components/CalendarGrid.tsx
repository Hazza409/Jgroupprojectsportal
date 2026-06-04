"use client";

import { useState } from "react";

export interface GridEvent {
  id: string;
  title: string;
  kind: "SITE_MEETING" | "MAINTENANCE" | "BOOKING";
  startISO: string;
}

const KIND_DOT: Record<string, string> = {
  SITE_MEETING: "bg-stone-400",
  MAINTENANCE: "bg-amber-500",
  BOOKING: "bg-emerald-500",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CalendarGrid({ events }: { events: GridEvent[] }) {
  // Group events by local Y-M-D.
  const byDay = new Map<string, GridEvent[]>();
  for (const e of events) {
    const k = ymd(new Date(e.startISO));
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(e);
  }

  // Start the view on the month of the soonest upcoming event, else today.
  const now = new Date();
  const future = events
    .map((e) => new Date(e.startISO))
    .filter((d) => d.getTime() >= now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  const initial = future[0] ?? now;
  const [view, setView] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));

  const monthLabel = view.toLocaleString("en-AU", { month: "long", year: "numeric" });
  const firstWeekday = (view.getDay() + 6) % 7; // Monday-based index of the 1st
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const todayKey = ymd(now);

  // 42 cells (6 weeks); leading blanks before day 1.
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const shift = (n: number) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));

  return (
    <div className="card p-0">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <button onClick={() => shift(-1)} className="btn-ghost !px-2 !py-1 text-sm" aria-label="Previous month">‹</button>
        <p className="text-sm font-semibold">{monthLabel}</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setView(new Date(now.getFullYear(), now.getMonth(), 1))} className="btn-ghost !px-2 !py-1 text-xs">Today</button>
          <button onClick={() => shift(1)} className="btn-ghost !px-2 !py-1 text-sm" aria-label="Next month">›</button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-stone-200 text-center text-[10px] uppercase tracking-wide text-stone-400">
        {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const key = day ? ymd(new Date(view.getFullYear(), view.getMonth(), day)) : `b${i}`;
          const dayEvents = day ? byDay.get(key) ?? [] : [];
          const isToday = day && key === todayKey;
          return (
            <div
              key={key}
              className={`min-h-[84px] border-b border-r border-stone-100 p-1.5 ${i % 7 === 0 ? "border-l" : ""} ${day ? "" : "bg-stone-50/50"}`}
            >
              {day && (
                <>
                  <div className={`mb-1 text-xs ${isToday ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-onbrand" : "text-stone-400"}`}>
                    {day}
                  </div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((e) => (
                      <div key={e.id} className="flex items-center gap-1 truncate text-[11px]" title={e.title}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${KIND_DOT[e.kind] ?? "bg-stone-400"}`} />
                        <span className="truncate">{e.title}</span>
                      </div>
                    ))}
                    {dayEvents.length > 3 && <div className="text-[10px] text-stone-400">+{dayEvents.length - 3} more</div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
