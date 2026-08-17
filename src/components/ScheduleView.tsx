"use client";

// ─────────────────────────────────────────────────────────────
// Construction programme, redesigned for readability.
//
// The old view was a Gantt only: no dates anywhere, task names truncated, a
// 662-day programme squeezed into ~800px so month labels collided, milestones
// drawn as invisible slivers, and sideways scrolling to read any of it.
//
// Two views now, LIST first because that's what actually answers "when does X
// happen": real Start/Finish dates, status, progress, no horizontal scroll.
// TIMELINE keeps the visual shape but with dates on the row, a today marker,
// status colour and milestones as labelled diamonds.
// ─────────────────────────────────────────────────────────────

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateScheduleProgress } from "@/app/projects/[projectId]/schedule/actions";
import { DateField } from "@/components/DateField";
import { runAction } from "@/lib/actionResult";
import { fmtDateShort } from "@/lib/dates";
import {
  preparePhases,
  summarise,
  currentAndNext,
  STATUS_LABEL,
  STATUS_STYLE,
  type ScheduleItemLike,
  type PreparedTask,
} from "@/lib/schedule";

type View = "list" | "timeline";

/** Date → "YYYY-MM-DD" for DateField's defaultValue. */
function isoDay(d: Date | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

function StatusChip({ status }: { status: PreparedTask["status"] }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLE[status].chip}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function ProgressCell({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full min-w-8 overflow-hidden rounded-full bg-stone-200/60">
        <div className="h-full rounded-full bg-brand" style={{ width: `${p}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-stone-500">{p > 0 ? `${Math.round(p)}%` : "—"}</span>
    </div>
  );
}

export function ScheduleView({
  items,
  projectName,
  projectId,
  isBuilder = false,
}: {
  items: ScheduleItemLike[];
  projectName: string;
  projectId: string;
  isBuilder?: boolean;
}) {
  const [view, setView] = useState<View>("list");
  const [zoom, setZoom] = useState(1);
  const [hidePast, setHidePast] = useState(false);
  // Fortnightly progress update: edit every row, save once.
  const [editing, setEditing] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const router = useRouter();

  function saveProgress(form: HTMLFormElement) {
    const fd = new FormData(form);
    startSaving(async () => {
      const res = await runAction(() => updateScheduleProgress(projectId, fd));
      setSaveMsg({ ok: res.ok, text: res.message });
      // Only leave edit mode once the save actually landed. On failure the
      // rows stay open with everything still typed into them, so a retry
      // costs a click rather than re-keying the whole update.
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  const phases = useMemo(() => preparePhases(items, projectName), [items, projectName]);
  const summary = useMemo(() => summarise(phases), [phases]);
  const upNext = useMemo(() => currentAndNext(phases, 30), [phases]);

  const visiblePhases = useMemo(
    () =>
      hidePast
        ? phases
            .map((p) => ({ ...p, tasks: p.tasks.filter((t) => t.status !== "complete") }))
            .filter((p) => p.tasks.length > 0)
        : phases,
    [phases, hidePast],
  );

  if (phases.length === 0) {
    return <div className="card text-stone-500">No scheduled tasks yet.</div>;
  }

  return (
    <div className="space-y-4">
      {/* ── Where the programme stands ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-stone-400">Programme</p>
          <p className="mt-1 text-sm font-medium">
            {fmtDateShort(summary.start)} → {fmtDateShort(summary.end)}
          </p>
          <p className="mt-1 text-xs text-stone-400">{summary.total} tasks</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-stone-400">Overall progress</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{Math.round(summary.percentComplete)}%</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-stone-200/60">
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, summary.percentComplete)}%` }} />
          </div>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-stone-400">Running now</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{summary.inProgress}</p>
          <p className="mt-1 text-xs text-stone-400">{summary.complete} complete · {summary.upcoming} upcoming</p>
        </div>
        <div className={`card ${summary.overdue > 0 ? "border-red-500/30" : ""}`}>
          <p className="text-xs uppercase tracking-wide text-stone-400">Behind programme</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${summary.overdue > 0 ? "text-red-700 dark:text-red-300" : ""}`}>
            {summary.overdue}
          </p>
          <p className="mt-1 text-xs text-stone-400">
            {summary.overdue > 0 ? "past their finish date" : "everything on track"}
          </p>
        </div>
      </div>

      {/* ── What's happening now / next month ── */}
      {upNext.length > 0 && (
        <div className="card">
          <p className="mb-2 text-xs uppercase tracking-wide text-stone-400">On site now &amp; next 30 days</p>
          <ul className="divide-y divide-stone-100">
            {upNext.slice(0, 6).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 break-words">{t.label}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums text-stone-500">
                    {fmtDateShort(t.startDate)}
                    {t.endDate && !t.isMilestone ? ` → ${fmtDateShort(t.endDate)}` : ""}
                  </span>
                  <StatusChip status={t.status} />
                </span>
              </li>
            ))}
          </ul>
          {upNext.length > 6 && (
            <p className="mt-2 text-xs text-stone-400">+ {upNext.length - 6} more in the next 30 days</p>
          )}
        </div>
      )}

      {/* ── View controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-stone-200">
          {(["list", "timeline"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm capitalize ${view === v ? "bg-brand text-onbrand" : "text-stone-600 hover:bg-stone-100"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {isBuilder && !editing && (
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 text-sm"
              onClick={() => { setView("list"); setEditing(true); setSaveMsg(null); }}
            >
              Edit tasks
            </button>
          )}
          <label className="flex items-center gap-2 text-xs text-stone-500">
            <input type="checkbox" checked={hidePast} onChange={(e) => setHidePast(e.target.checked)} className="accent-brand" />
            Hide completed
          </label>
          {view === "timeline" && (
            <div className="flex items-center gap-1 text-xs text-stone-500">
              <button type="button" className="btn-ghost !px-2.5 !py-1" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} disabled={zoom <= 1}>−</button>
              <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
              <button type="button" className="btn-ghost !px-2.5 !py-1" onClick={() => setZoom((z) => Math.min(6, z * 1.5))} disabled={zoom >= 6}>+</button>
            </div>
          )}
        </div>
      </div>

      {saveMsg && (
        <p
          className={`text-sm ${
            saveMsg.ok
              ? "text-emerald-700 dark:text-emerald-200"
              : "rounded-md bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-300"
          }`}
          role={saveMsg.ok ? undefined : "alert"}
        >
          {saveMsg.text}
        </p>
      )}

      {view === "list" ? (
        editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveProgress(e.currentTarget);
            }}
          >
            <ListView phases={visiblePhases} editing />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save progress"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </button>
              <span className="text-xs text-stone-400">
                Edit dates, days and progress on any row. Leave Days blank to recalculate it from the dates.
              </span>
            </div>
          </form>
        ) : (
          <ListView phases={visiblePhases} />
        )
      ) : (
        <TimelineView phases={visiblePhases} zoom={zoom} />
      )}
    </div>
  );
}

/** Dates-first table. No horizontal scroll; nothing truncated. */
function ListView({ phases, editing = false }: { phases: ReturnType<typeof preparePhases>; editing?: boolean }) {
  return (
    <div className="card p-0">
      <table className="w-full table-fixed text-xs sm:text-sm">
        <colgroup>
          <col className={editing ? "w-[26%]" : "w-[38%]"} />
          <col className={editing ? "w-[17%]" : "w-[13%]"} />
          <col className={editing ? "w-[17%]" : "w-[13%]"} />
          <col className={editing ? "w-[10%]" : "w-[9%]"} />
          <col className="w-[12%]" />
          <col className={editing ? "w-[18%]" : "w-[15%]"} />
        </colgroup>
        <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2.5">Task</th>
            <th className="px-2 py-2.5">Start</th>
            <th className="px-2 py-2.5">Finish</th>
            <th className="px-2 py-2.5 text-right">Days</th>
            <th className="px-2 py-2.5">Status</th>
            <th className="px-2 py-2.5">Progress</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 align-top">
          {/*
            The keyed element must be the FRAGMENT — it's what the map returns.
            A bare <> can't take one, so React fell back to position. That is
            not cosmetic here: the rows hold uncontrolled inputs, so when the
            list changes shape (the "hide past" filter, or a save re-render)
            React re-uses DOM nodes by index and typed values can end up
            against the wrong task.
          */}
          {phases.map((p) => (
            <Fragment key={p.name}>
              <tr className="bg-stone-100/60">
                <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide break-words">{p.name}</td>
                <td className="px-2 py-2 text-xs tabular-nums text-stone-500">{fmtDateShort(p.start)}</td>
                <td className="px-2 py-2 text-xs tabular-nums text-stone-500">{fmtDateShort(p.end)}</td>
                <td className="px-2 py-2" />
                <td className="px-2 py-2" />
                <td className="px-2 py-2 text-xs tabular-nums text-stone-500">{Math.round(p.percentComplete)}%</td>
              </tr>
              {p.tasks.map((t) => (
                <tr key={t.id} className={t.status === "overdue" ? "bg-red-500/5" : undefined}>
                  <td className="px-3 py-2 pl-5 break-words">
                    {t.isMilestone && <span className="mr-1 text-stone-400">◆</span>}
                    {t.label}
                  </td>
                  <td className="px-2 py-2 tabular-nums whitespace-nowrap text-stone-600">
                    {editing ? (
                      <DateField name={`start_${t.id}`} defaultValue={isoDay(t.startDate)} compact />
                    ) : (
                      fmtDateShort(t.startDate)
                    )}
                  </td>
                  <td className="px-2 py-2 tabular-nums whitespace-nowrap text-stone-600">
                    {editing ? (
                      <DateField name={`finish_${t.id}`} defaultValue={isoDay(t.endDate)} compact />
                    ) : t.isMilestone ? (
                      "—"
                    ) : (
                      fmtDateShort(t.endDate)
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-stone-500">
                    {editing ? (
                      <input
                        name={`days_${t.id}`}
                        type="number"
                        min={0}
                        defaultValue={t.durationDays > 0 ? t.durationDays : ""}
                        placeholder="auto"
                        className="input !w-16 !py-1 text-right text-xs"
                        aria-label={`Days for ${t.label}`}
                      />
                    ) : t.isMilestone ? (
                      "—"
                    ) : t.durationDays > 0 ? (
                      t.durationDays
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-2"><StatusChip status={t.status} /></td>
                  <td className="px-2 py-2">
                    {editing ? (
                      <div className="flex items-center gap-1">
                        <input
                          name={`pct_${t.id}`}
                          type="number"
                          min={0}
                          max={100}
                          // step must stay 1. Anything coarser (5 for tidy
                          // stepper arrows) makes the browser reject 62, 47,
                          // 33 — it silently blocks the whole form, so Save
                          // looks broken rather than saying anything.
                          step={1}
                          defaultValue={Math.round(t.percentComplete)}
                          className="input !w-16 !py-1 text-right text-xs"
                          aria-label={`Progress for ${t.label}`}
                        />
                        <span className="text-xs text-stone-400">%</span>
                      </div>
                    ) : (
                      <ProgressCell pct={t.percentComplete} />
                    )}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Visual timeline — fits the card at 100%, with dates on every row. */
function TimelineView({ phases, zoom }: { phases: ReturnType<typeof preparePhases>; zoom: number }) {
  const tasks = phases.flatMap((p) => p.tasks);
  const dated = tasks.filter((t) => t.startDate);
  if (dated.length === 0) return <div className="card text-stone-500">No dates to chart yet.</div>;

  const minT = Math.min(...dated.map((t) => new Date(t.startDate!).getTime()));
  const maxT = Math.max(...dated.map((t) => new Date(t.endDate ?? t.startDate!).getTime()));
  const start = new Date(minT);
  const from = new Date(start.getFullYear(), start.getMonth(), 1).getTime();
  const endD = new Date(maxT);
  const to = new Date(endD.getFullYear(), endD.getMonth() + 1, 1).getTime();
  const span = Math.max(to - from, 1);
  const pct = (t: number) => ((t - from) / span) * 100;

  // Month ticks. When the programme is long, label only every other month at
  // 100% so headings never collide — zooming in reveals the rest.
  const ticks: { label: string; year: number | null; left: number; show: boolean }[] = [];
  let cursor = new Date(from);
  let i = 0;
  const monthCount = Math.round(span / (30.44 * 86_400_000));
  const stride = zoom >= 2 ? 1 : monthCount > 18 ? 3 : monthCount > 10 ? 2 : 1;
  while (cursor.getTime() < to) {
    ticks.push({
      label: cursor.toLocaleString("en-AU", { month: "short" }),
      year: cursor.getMonth() === 0 || i === 0 ? cursor.getFullYear() : null,
      left: pct(cursor.getTime()),
      show: i % stride === 0,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    i++;
  }

  const todayPct = pct(Date.now());
  const showToday = todayPct >= 0 && todayPct <= 100;
  /** Labels past this point would overflow the card, so draw them leftwards. */
  const flip = (leftPct: number) => leftPct > 62;

  return (
    <div className="card p-0">
      <div className={zoom > 1 ? "overflow-x-auto" : ""}>
        <div style={{ width: `${zoom * 100}%`, minWidth: zoom > 1 ? 900 : undefined }}>
          {/* Month axis */}
          <div className="relative h-9 border-b border-stone-200 bg-stone-50">
            {ticks.map((t, idx) => (
              <div key={idx} className="absolute bottom-0 top-0 border-l border-stone-200/70" style={{ left: `${t.left}%` }}>
                {t.show && (
                  <span className="absolute bottom-1 left-1 whitespace-nowrap text-[10px] uppercase tracking-wide text-stone-500">
                    {t.label}
                    {t.year && <span className="ml-1 font-semibold text-stone-400">{t.year}</span>}
                  </span>
                )}
              </div>
            ))}
            {showToday && (
              <div className="absolute bottom-0 top-0 z-10 border-l-2 border-brand" style={{ left: `${todayPct}%` }}>
                <span className="absolute -top-0 left-1 rounded bg-brand px-1 text-[9px] font-medium text-onbrand">Today</span>
              </div>
            )}
          </div>

          {phases.map((p) => (
            <div key={p.name}>
              <div className="border-b border-stone-200 bg-stone-100/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide">
                {p.name}
                <span className="ml-2 font-normal normal-case text-stone-400">
                  {fmtDateShort(p.start)} → {fmtDateShort(p.end)}
                </span>
              </div>
              {p.tasks.map((t) => {
                const s = t.startDate ? new Date(t.startDate).getTime() : null;
                const e = t.endDate ? new Date(t.endDate).getTime() : s;
                const left = s !== null ? pct(s) : 0;
                const width = s !== null && e !== null ? Math.max(pct(e) - left, 0.4) : 0;
                return (
                  <div key={t.id} className="relative h-9 border-b border-stone-100 hover:bg-stone-50">
                    {/* gridlines */}
                    {ticks.map((tk, idx) => (
                      <div key={idx} className="absolute bottom-0 top-0 border-l border-stone-100" style={{ left: `${tk.left}%` }} />
                    ))}
                    {showToday && (
                      <div className="absolute bottom-0 top-0 border-l border-brand/40" style={{ left: `${todayPct}%` }} />
                    )}
                    {s !== null && (
                      t.isMilestone ? (
                        // Past ~65% across, the label would run off the card, so
                        // flip it to the left of the diamond instead.
                        <div
                          className={`absolute top-1/2 flex -translate-y-1/2 items-center whitespace-nowrap ${flip(left) ? "flex-row-reverse" : ""}`}
                          style={flip(left) ? { right: `${100 - left}%` } : { left: `${left}%` }}
                        >
                          <span className={`inline-block h-2.5 w-2.5 shrink-0 rotate-45 ${STATUS_STYLE[t.status].bar}`} />
                          <span className={`text-xs text-stone-600 ${flip(left) ? "mr-2" : "ml-2"}`}>
                            {t.label} <span className="text-stone-400">{fmtDateShort(t.startDate)}</span>
                          </span>
                        </div>
                      ) : (
                        <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `${left}%`, width: `${width}%` }}>
                          <div className="h-4 w-full overflow-hidden rounded bg-stone-300/40 ring-1 ring-stone-300/40">
                            <div className={`h-full ${STATUS_STYLE[t.status].bar}`} style={{ width: `${Math.min(100, t.percentComplete)}%` }} />
                          </div>
                          {/* Label sits OUTSIDE the bar so it stays readable however
                              short the bar is — flipped left near the right edge. */}
                          <span
                            className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-xs text-stone-600 ${
                              flip(left + width) ? "right-full mr-2" : "left-full ml-2"
                            }`}
                          >
                            {t.label}
                            <span className="ml-1.5 text-stone-400">
                              {fmtDateShort(t.startDate)} → {fmtDateShort(t.endDate)}
                            </span>
                          </span>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 px-3 py-2 text-xs text-stone-500">
        {(["complete", "in-progress", "upcoming", "overdue"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-3 rounded-sm ${STATUS_STYLE[s].bar}`} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">◆ Milestone</span>
      </div>
    </div>
  );
}
