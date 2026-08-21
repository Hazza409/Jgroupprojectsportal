"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLineForecast, signOffForecast, withdrawLineForecast } from "@/app/projects/[projectId]/actions";
import { runAction } from "@/lib/actionResult";
import { formatCents, moneyStructure, type MarginGstRates } from "@/lib/money";

// ─────────────────────────────────────────────────────────────
// The builder's forecasting workbench — ONE surface, not three.
//
// The first cut grew by accretion: a sign-off card, then a separate editor
// card, then the movement list further down — stage in one place, watch the
// result appear in another, approve in a third, with a full server re-render
// between each step and nothing on screen while it ran. That is the "frozen,
// janky" experience this replaces.
//
//   · every cost code is ONE row: budget, spent, forecast, status, edit
//   · movements sort to the top; untouched codes sit behind a toggle
//   · the sign-off bar lives at the top of the same list it publishes
//   · every server wait shows a visible working state — the screen never
//     goes quiet while something is happening
// ─────────────────────────────────────────────────────────────

export interface WorkbenchRow {
  id: string;
  code: string;
  name: string;
  /** All money inc margin + GST — one basis, matching the page banner. */
  budgetCents: number;
  spentCents: number;
  publishedCents: number | null;
  publishedNote: string | null;
  /** Staged dollars ("" when none), same inc basis as everything shown. */
  stagedDollars: string;
  stagedNote: string;
  /** Ex-margin/ex-GST bases, for the base + BM + GST structure rows. */
  bases: { budget: number; spent: number; forecast: number | null };
}

export function ForecastWorkbench({
  projectId,
  rows,
  canSign,
  gateWarning,
  outstanding,
  alsoStaged = [],
  rates,
}: {
  projectId: string;
  rows: WorkbenchRow[];
  canSign: boolean;
  gateWarning: string | null;
  outstanding: string[];
  /** Staged whole-job figures (from Settings) that the same signature publishes. */
  alsoStaged?: string[];
  rates: MarginGstRates;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Undo asks first: it changes a figure the client can already see.
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  // Two transitions so the UI can say WHICH thing it's doing: awaiting the
  // server action, vs re-fetching the page data afterwards. The second is what
  // used to look like a freeze.
  const [acting, startActing] = useTransition();
  const [refreshing, startRefreshing] = useTransition();
  const busy = acting || refreshing;

  function afterAction(res: { ok: boolean; message: string }) {
    setMsg({ ok: res.ok, text: res.message });
    if (res.ok) {
      setOpenId(null);
      startRefreshing(() => router.refresh());
    }
  }

  function stage(costCodeId: string, form: HTMLFormElement) {
    const fd = new FormData(form);
    startActing(async () => afterAction(await runAction(() => setLineForecast(projectId, costCodeId, fd))));
  }
  function signOff() {
    startActing(async () => afterAction(await runAction(() => signOffForecast(projectId))));
  }
  function undo(costCodeId: string) {
    setConfirmUndo(null);
    startActing(async () => afterAction(await runAction(() => withdrawLineForecast(projectId, costCodeId))));
  }

  // Movements first — that's what this tab is for. Forecast-above by size,
  // then unexplained overspend by size, then everything else behind a toggle.
  const weight = (r: WorkbenchRow) => {
    if (r.stagedDollars !== "") return 3e15; // staged work floats to the top while in progress
    if (r.publishedCents !== null && r.publishedCents > r.budgetCents) return 2e15 + (r.publishedCents - r.budgetCents);
    if (r.spentCents > r.budgetCents) return 1e15 + (r.spentCents - r.budgetCents);
    // A published saving is news too — keep it visible without the toggle.
    if (r.publishedCents !== null && r.publishedCents < r.budgetCents) return 0.5e15 + (r.budgetCents - r.publishedCents);
    return 0;
  };
  const sorted = [...rows].sort((a, b) => weight(b) - weight(a) || (a.code < b.code ? -1 : 1));
  const active = sorted.filter((r) => weight(r) > 0);
  const shown = showAll ? sorted : active;
  const staged = rows.filter((r) => r.stagedDollars !== "");
  const stagedCount = staged.length + alsoStaged.length;

  return (
    <div className="card p-0">
      {/* ── Working strip: the screen is never silently busy ── */}
      <div
        className={`h-0.5 w-full overflow-hidden rounded-t-md ${busy ? "bg-amber-500/30" : "bg-transparent"}`}
        aria-hidden
      >
        {busy && <div className="h-full w-1/3 animate-pulse rounded-full bg-amber-500" />}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Forecast adjustments</h2>
        <span className="text-xs text-stone-400" role="status">
          {acting ? "Saving…" : refreshing ? "Updating figures…" : "All figures incl. builder's margin & GST"}
        </span>
      </div>

      {/* ── Sign-off bar: approval lives on the list it publishes ── */}
      {stagedCount > 0 && (
        <div className="mx-4 mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              {stagedCount} staged change{stagedCount === 1 ? "" : "s"} — the client sees nothing until sign-off
            </p>
            {canSign ? (
              <button type="button" className="btn-primary !px-3 !py-1.5 text-sm" onClick={signOff} disabled={busy}>
                {acting ? "Signing…" : "Sign off & publish"}
              </button>
            ) : (
              <span className="text-xs text-stone-500">Awaiting {outstanding.join(", ")}</span>
            )}
          </div>
          {alsoStaged.length > 0 && (
            <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-100/80">
              Also publishes the staged whole-job figures: {alsoStaged.join(" · ")}
            </p>
          )}
          {gateWarning && <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">⚠ {gateWarning}</p>}
        </div>
      )}

      {msg && (
        <p
          className={`mx-4 mt-3 text-sm ${
            msg.ok ? "text-emerald-700 dark:text-emerald-200" : "rounded-md bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-300"
          }`}
          role={msg.ok ? "status" : "alert"}
        >
          {msg.text}
        </p>
      )}

      {/* ── One row per cost code ── */}
      <div className="mt-3 overflow-x-auto">
        <div className="min-w-[40rem]">
          <div className="grid grid-cols-[minmax(11rem,2fr)_1fr_1fr_1fr_minmax(9rem,1.2fr)_4.5rem] gap-2 border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs uppercase tracking-wide text-stone-500">
            <span>Cost item</span>
            <span className="text-right">Budget</span>
            <span className="text-right">Spent</span>
            <span className="text-right">Forecast</span>
            <span>Status</span>
            <span />
          </div>

          {shown.map((r) => {
            const open = openId === r.id;
            const isStaged = r.stagedDollars !== "";
            const forecastAbove = r.publishedCents !== null && r.publishedCents > r.budgetCents;
            const spendAbove = r.publishedCents === null && r.spentCents > r.budgetCents;
            return (
              <div key={r.id} className={`border-b border-stone-100 ${forecastAbove || spendAbove || isStaged ? "bg-amber-500/5" : ""}`}>
                <div className="grid grid-cols-[minmax(11rem,2fr)_1fr_1fr_1fr_minmax(9rem,1.2fr)_4.5rem] items-baseline gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-mono text-xs text-stone-400">{r.code}</span> {r.name}
                    {r.publishedNote && !isStaged && (
                      <span className="block text-xs text-stone-400">{r.publishedNote}</span>
                    )}
                  </span>
                  <span className="text-right tabular-nums whitespace-nowrap">{formatCents(r.budgetCents)}</span>
                  <span className="text-right tabular-nums whitespace-nowrap">{formatCents(r.spentCents)}</span>
                  <span className="text-right tabular-nums whitespace-nowrap font-medium">
                    {isStaged ? formatCents(Math.round(Number(r.stagedDollars) * 100)) : r.publishedCents !== null ? formatCents(r.publishedCents) : "—"}
                  </span>
                  <span>
                    {isStaged ? (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900 dark:text-amber-100">
                        Staged — not signed off
                      </span>
                    ) : forecastAbove ? (
                      <span className="text-xs font-medium tabular-nums text-amber-800 dark:text-amber-200">
                        +{formatCents(r.publishedCents! - r.budgetCents)} above budget
                      </span>
                    ) : spendAbove ? (
                      <span className="text-xs text-amber-800 dark:text-amber-200">
                        Spend above budget — forecast it
                      </span>
                    ) : r.publishedCents !== null && r.publishedCents < r.budgetCents ? (
                      <span className="text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                        −{formatCents(r.budgetCents - r.publishedCents)} under budget
                      </span>
                    ) : (
                      <span className="text-xs text-stone-400">On track</span>
                    )}
                  </span>
                  <span className="flex justify-self-end gap-1">
                    <button
                      type="button"
                      className="btn-ghost !px-2 !py-1 text-xs"
                      onClick={() => { setOpenId(open ? null : r.id); setMsg(null); setConfirmUndo(null); }}
                      disabled={busy}
                    >
                      {open ? "Close" : isStaged || r.publishedCents !== null ? "Change" : "Forecast"}
                    </button>
                    {r.publishedCents !== null && (
                      <button
                        type="button"
                        className="btn-ghost !px-2 !py-1 text-xs"
                        onClick={() => { setConfirmUndo(confirmUndo === r.id ? null : r.id); setMsg(null); }}
                        disabled={busy}
                        title="Remove this published forecast and revert the line to its approved budget"
                      >
                        Undo
                      </button>
                    )}
                  </span>
                </div>

                {confirmUndo === r.id && (
                  <div className="border-t border-dashed border-amber-500/40 bg-amber-500/10 px-4 py-3" role="alert">
                    <p className="text-sm text-amber-900 dark:text-amber-100">
                      Remove the published forecast of{" "}
                      <span className="font-medium tabular-nums">{formatCents(r.publishedCents ?? 0)}</span> from{" "}
                      {r.name}? The client sees this figure now; the line reverts to its approved budget of{" "}
                      <span className="font-medium tabular-nums">{formatCents(r.budgetCents)}</span>. The original
                      publication stays on the record and the withdrawal is logged.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn-primary !px-3 !py-1.5 text-sm" onClick={() => undo(r.id)} disabled={busy}>
                        {acting ? "Removing…" : "Remove forecast"}
                      </button>
                      <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={() => setConfirmUndo(null)} disabled={busy}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {open && (
                  <div className="border-t border-dashed border-stone-200 bg-stone-50/60 px-4 py-3">
                    {/* The structure of each figure: base + BM + GST = total.
                        GST absorbs the rounding so columns sum exactly to the
                        totals shown above. */}
                    <div className="overflow-x-auto">
                      <table className="w-auto text-xs tabular-nums">
                        <thead>
                          <tr className="text-left uppercase tracking-wide text-stone-400">
                            <th className="pr-4 py-1 font-medium" />
                            <th className="pr-4 py-1 font-medium text-right">Base cost</th>
                            <th className="pr-4 py-1 font-medium text-right">Builder&apos;s margin ({rates.marginPercent.toFixed(1)}%)</th>
                            <th className="pr-4 py-1 font-medium text-right">GST ({rates.gstPercent.toFixed(0)}%)</th>
                            <th className="py-1 font-medium text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="text-stone-600 dark:text-stone-300">
                          {([["Budget", r.bases.budget], ["Spent", r.bases.spent], ...(r.bases.forecast !== null ? [["Forecast", r.bases.forecast] as [string, number]] : [])] as [string, number][]).map(([label, base]) => {
                            const m = moneyStructure(base, rates);
                            return (
                              <tr key={label}>
                                <td className="pr-4 py-0.5 text-stone-400">{label}</td>
                                <td className="pr-4 py-0.5 text-right">{formatCents(m.baseCents)}</td>
                                <td className="pr-4 py-0.5 text-right">+{formatCents(m.marginCents)}</td>
                                <td className="pr-4 py-0.5 text-right">+{formatCents(m.gstCents)}</td>
                                <td className="py-0.5 text-right font-medium">{formatCents(m.totalCents)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  <form
                    className="mt-3 grid gap-3 sm:grid-cols-[11rem_1fr_auto] sm:items-start"
                    onSubmit={(e) => { e.preventDefault(); stage(r.id, e.currentTarget); }}
                  >
                    <div>
                      <label className="label text-xs" htmlFor={`f_${r.id}`}>
                        Expected final cost (incl. margin &amp; GST)
                      </label>
                      <input
                        id={`f_${r.id}`} name="forecast" type="number" step="0.01" min="0"
                        className="input" placeholder="0.00" defaultValue={r.stagedDollars} autoFocus
                      />
                      <p className="mt-1 text-xs text-stone-400">Leave blank to withdraw the staged figure.</p>
                    </div>
                    <div>
                      <label className="label text-xs" htmlFor={`n_${r.id}`}>Reason (shown to the client)</label>
                      <input
                        id={`n_${r.id}`} name="note" className="input"
                        placeholder="e.g. extended scaffold hire while the facade is remediated"
                        defaultValue={r.stagedNote}
                      />
                    </div>
                    <button type="submit" className="btn-primary sm:mt-6" disabled={busy}>
                      {acting ? "Saving…" : "Stage"}
                    </button>
                  </form>
                  </div>
                )}
              </div>
            );
          })}

          {shown.length === 0 && (
            <p className="px-4 py-4 text-sm text-stone-500">
              Every cost code is tracking at or below its budget, and nothing is staged.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        {rows.length > active.length ? (
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={() => setShowAll(!showAll)} disabled={busy}>
            {showAll ? "Show movements only" : `Show all ${rows.length} cost codes`}
          </button>
        ) : <span />}
        <span className="text-xs text-stone-400">Signing publishes every staged change and records your name.</span>
      </div>
    </div>
  );
}
