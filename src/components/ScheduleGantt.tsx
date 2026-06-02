// Monochrome construction-programme Gantt — mirrors the J Group printed schedule:
// trade-grouped tasks with Duration + Progress, and horizontal bars across a
// month/quarter time axis. Pure server component (positions computed inline).

interface Item {
  id: string;
  group: string | null;
  taskName: string;
  startDate: Date | null;
  endDate: Date | null;
  durationDays: number;
  percentComplete: number;
}

const DAY = 86_400_000;

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

export function ScheduleGantt({ items }: { items: Item[] }) {
  const dated = items.filter((i) => i.startDate && i.endDate);
  if (dated.length === 0) {
    return <div className="card text-stone-500">No scheduled dates to chart yet.</div>;
  }

  const min = startOfMonth(new Date(Math.min(...dated.map((i) => i.startDate!.getTime()))));
  const maxEnd = new Date(Math.max(...dated.map((i) => i.endDate!.getTime())));
  const max = addMonth(maxEnd);
  const totalMs = max.getTime() - min.getTime();
  const pct = (t: number) => ((t - min.getTime()) / totalMs) * 100;

  // Month ticks (with year shown at January / first column).
  const months: { label: string; year: string | null; left: number }[] = [];
  for (let m = new Date(min); m < max; m = addMonth(m)) {
    const isJan = m.getUTCMonth() === 0;
    months.push({
      label: m.toLocaleString("en-AU", { month: "short", timeZone: "UTC" }),
      year: isJan || months.length === 0 ? String(m.getUTCFullYear()) : null,
      left: pct(m.getTime()),
    });
  }

  // Preserve order; group consecutively by trade.
  const groups: { name: string; items: Item[] }[] = [];
  for (const it of items) {
    const name = it.group ?? "General";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(it);
    else groups.push({ name, items: [it] });
  }

  const LEFT = "minmax(220px,260px) 64px 56px";
  const TIMELINE_MIN = 820;

  return (
    <div className="card overflow-x-auto p-0">
      <div style={{ minWidth: 340 + TIMELINE_MIN }}>
        {/* Header */}
        <div
          className="sticky top-0 grid items-end border-b border-stone-200 bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500"
          style={{ gridTemplateColumns: `${LEFT} 1fr` }}
        >
          <div className="px-4 py-3">Task</div>
          <div className="py-3 text-right">Duration</div>
          <div className="py-3 pr-3 text-right">Progress</div>
          <div className="relative h-10" style={{ minWidth: TIMELINE_MIN }}>
            {months.map((mo, i) => (
              <div key={i} className="absolute bottom-0 top-0 border-l border-stone-200/70" style={{ left: `${mo.left}%` }}>
                <span className="absolute bottom-1 left-1 whitespace-nowrap">{mo.label}</span>
                {mo.year && <span className="absolute left-1 top-1 font-semibold text-stone-400">{mo.year}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Rows */}
        {groups.map((g) => {
          const gDated = g.items.filter((i) => i.startDate && i.endDate);
          const gLeft = gDated.length ? pct(Math.min(...gDated.map((i) => i.startDate!.getTime()))) : 0;
          const gRight = gDated.length ? pct(Math.max(...gDated.map((i) => i.endDate!.getTime()))) : 0;
          return (
            <div key={g.name}>
              {/* Group header row */}
              <div
                className="grid items-center border-b border-stone-200 bg-stone-100/60"
                style={{ gridTemplateColumns: `${LEFT} 1fr` }}
              >
                <div className="truncate px-4 py-2 text-xs font-semibold uppercase tracking-wide">{g.name}</div>
                <div />
                <div />
                <div className="relative h-7" style={{ minWidth: TIMELINE_MIN }}>
                  {gDated.length > 0 && (
                    <div
                      className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-stone-400/40"
                      style={{ left: `${gLeft}%`, width: `${Math.max(gRight - gLeft, 0.4)}%` }}
                    />
                  )}
                </div>
              </div>

              {/* Task rows */}
              {g.items.map((it) => {
                const has = it.startDate && it.endDate;
                const left = has ? pct(it.startDate!.getTime()) : 0;
                const width = has ? Math.max(pct(it.endDate!.getTime()) - left, 0.6) : 0;
                return (
                  <div
                    key={it.id}
                    className="grid items-center border-b border-stone-100 text-sm hover:bg-stone-50"
                    style={{ gridTemplateColumns: `${LEFT} 1fr` }}
                  >
                    <div className="truncate px-4 py-2 pl-6 text-stone-300">{it.taskName}</div>
                    <div className="py-2 text-right text-xs tabular-nums text-stone-500">
                      {it.durationDays > 0 ? `${it.durationDays}d` : "—"}
                    </div>
                    <div className="py-2 pr-3 text-right text-xs tabular-nums text-stone-500">
                      {it.percentComplete > 0 ? `${Math.round(it.percentComplete)}%` : ""}
                    </div>
                    <div className="relative h-7" style={{ minWidth: TIMELINE_MIN }}>
                      {/* month gridlines */}
                      {months.map((mo, i) => (
                        <div key={i} className="absolute bottom-0 top-0 border-l border-stone-100" style={{ left: `${mo.left}%` }} />
                      ))}
                      {has ? (
                        <div
                          className="absolute top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-sm bg-stone-300/50 ring-1 ring-stone-300/40"
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${it.taskName} · ${Math.round(it.percentComplete)}%`}
                        >
                          <div className="h-full bg-ink/80" style={{ width: `${Math.min(100, it.percentComplete)}%` }} />
                        </div>
                      ) : (
                        // milestone (no dates) — a small diamond marker at its start
                        <div
                          className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-stone-400"
                          style={{ left: `${left}%` }}
                          title={`${it.taskName} (milestone)`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
