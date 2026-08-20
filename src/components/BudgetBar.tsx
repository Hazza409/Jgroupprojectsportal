// Spend bar shared by the Budget and Forecast Adjustments tabs. Pure markup (no
// client state) so it works in server components.
//
// Colour is the signal: brand under 90%, amber from 90% and above.
//
// There is deliberately NO red here (Jake, Budget Revisions §3). Red on a
// spend-vs-estimate bar means "you have spent more than a number we never
// committed to" — and on a cost-plus job it fires early on any front-loaded
// line (scaffold, plant hire, preliminaries) while the job is barely started.
// In the client's own portal that reads as a self-reported breach. Red is
// reserved for a genuine forecast-above-estimate signal, which needs a
// per-line forecast the portal does not hold yet.
export function BudgetBar({ pct, thick = false }: { pct: number; thick?: boolean }) {
  const width = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 100;
  const over = !Number.isFinite(pct) || pct > 100;
  const colour = over || pct >= 90 ? "bg-amber-500" : "bg-brand";
  return (
    <div className={`${thick ? "h-3" : "h-2"} w-full overflow-hidden rounded-full bg-stone-100`}>
      <div className={`h-full rounded-full ${colour}`} style={{ width: `${width}%` }} />
    </div>
  );
}

/** % of budget used for a code. Infinity when money is spent against no budget. */
export function pctUsed(currentCents: number, budgetCents: number): number {
  if (budgetCents > 0) return (currentCents / budgetCents) * 100;
  return currentCents > 0 ? Infinity : 0;
}

/** "82%" / "—" when there's no budget to measure against. */
export function fmtPct(pct: number): string {
  return Number.isFinite(pct) ? `${pct.toFixed(0)}%` : "—";
}
