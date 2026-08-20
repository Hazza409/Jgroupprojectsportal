"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLineForecast } from "@/app/projects/[projectId]/actions";
import { runAction } from "@/lib/actionResult";
import { formatCents } from "@/lib/money";

export interface ForecastLine {
  id: string;
  code: string;
  name: string;
  /** Original estimate + approved variations, grossed. */
  approvedBudgetCents: number;
  spentCents: number;
  /** Published forecast, grossed. Null when nobody has forecast it. */
  publishedForecastCents: number | null;
  /** Staged, awaiting sign-off. Plain dollars for the input, "" when unset. */
  pendingDollars: string;
  pendingNote: string;
}

/**
 * Forecast what a cost code will FINISH at, before spend gets there.
 *
 * Every code is listed, not just ones already above budget — the point is to
 * flag a movement early, and a code you can't reach until it's already over is
 * no use for that.
 *
 * Entries are staged: the client keeps seeing the last published figure until
 * the revision is signed off in Settings. Saving one line voids any signatures
 * already given, which is why the panel says so rather than letting someone
 * discover it when publishing.
 */
export function LineForecastEditor({
  projectId,
  lines,
  gateNote,
}: {
  projectId: string;
  lines: ForecastLine[];
  /** One line describing what happens after saving (who must sign off). */
  gateNote: string;
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  function save(costCodeId: string, form: HTMLFormElement) {
    const fd = new FormData(form);
    startSaving(async () => {
      const res = await runAction(() => setLineForecast(projectId, costCodeId, fd));
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) {
        setOpenId(null);
        router.refresh();
      }
    });
  }

  // Anything already forecast, or already spending above budget, is what a
  // builder most likely wants to act on — so those show first and the rest
  // stay behind a toggle rather than making this a wall of every trade.
  const notable = lines.filter(
    (l) => l.pendingDollars !== "" || l.publishedForecastCents !== null || l.spentCents > l.approvedBudgetCents,
  );
  const shown = showAll ? lines : notable;

  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Forecast a movement</h2>
        <span className="text-xs text-stone-400">{gateNote}</span>
      </div>
      <p className="mt-1 text-sm text-stone-500">
        Set what a cost code is expected to finish at. Staged figures are not shown to the client until the
        forecast is signed off.
      </p>

      {msg && (
        <p
          className={`mt-3 text-sm ${
            msg.ok ? "text-emerald-700 dark:text-emerald-200" : "rounded-md bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-300"
          }`}
          role={msg.ok ? undefined : "alert"}
        >
          {msg.text}
        </p>
      )}

      <ul className="mt-3 divide-y divide-stone-100">
        {shown.map((l) => {
          const open = openId === l.id;
          const staged = l.pendingDollars !== "";
          return (
            <li key={l.id} className="py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-mono text-xs text-stone-400">{l.code}</span> {l.name}
                </span>
                <span className="flex flex-wrap items-center gap-3 text-xs tabular-nums text-stone-500">
                  <span>Budget {formatCents(l.approvedBudgetCents)}</span>
                  <span>Spent {formatCents(l.spentCents)}</span>
                  <span className={l.publishedForecastCents !== null ? "font-medium text-stone-600 dark:text-stone-300" : ""}>
                    Forecast{" "}
                    {l.publishedForecastCents !== null ? formatCents(l.publishedForecastCents) : "—"}
                  </span>
                  {staged && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900 dark:text-amber-100">
                      Staged
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn-ghost !px-2 !py-1 text-xs"
                    onClick={() => { setOpenId(open ? null : l.id); setMsg(null); }}
                  >
                    {open ? "Close" : l.publishedForecastCents !== null || staged ? "Change" : "Forecast"}
                  </button>
                </span>
              </div>

              {open && (
                <form
                  className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-start"
                  onSubmit={(e) => { e.preventDefault(); save(l.id, e.currentTarget); }}
                >
                  <div>
                    <label className="label text-xs" htmlFor={`f_${l.id}`}>Expected final cost</label>
                    <input
                      id={`f_${l.id}`}
                      name="forecast"
                      type="number"
                      step="0.01"
                      min="0"
                      className="input"
                      placeholder="0.00"
                      defaultValue={l.pendingDollars}
                    />
                    <p className="mt-1 text-xs text-stone-400">Leave blank to withdraw.</p>
                  </div>
                  <div>
                    <label className="label text-xs" htmlFor={`n_${l.id}`}>Reason</label>
                    <input
                      id={`n_${l.id}`}
                      name="note"
                      className="input"
                      placeholder="e.g. extended scaffold hire while facade is remediated"
                      defaultValue={l.pendingNote}
                    />
                    <p className="mt-1 text-xs text-stone-400">
                      Shown to the client with the figure. A movement with a reason is far easier to accept.
                    </p>
                  </div>
                  <button type="submit" className="btn-primary sm:mt-6" disabled={saving}>
                    {saving ? "Saving…" : "Stage"}
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      {shown.length === 0 && (
        <p className="mt-3 text-sm text-stone-500">Nothing forecast yet.</p>
      )}
      {lines.length > notable.length && (
        <button type="button" className="btn-ghost mt-3 !px-3 !py-1.5 text-sm" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show only active ones" : `Show all ${lines.length} cost codes`}
        </button>
      )}
    </div>
  );
}
