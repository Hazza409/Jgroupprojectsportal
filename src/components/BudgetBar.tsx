// Spend bar shared by the Budget and Overruns tabs. Pure markup (no client
// state) so it works in server components.
//
// Colour is the signal: brand under 90%, amber from 90% (about to blow), red
// once over budget. Same thresholds on both tabs so they read consistently.
export function BudgetBar({ pct, thick = false }: { pct: number; thick?: boolean }) {
  const width = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 100;
  const over = !Number.isFinite(pct) || pct > 100;
  const colour = over ? "bg-red-500" : pct >= 90 ? "bg-amber-500" : "bg-brand";
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
