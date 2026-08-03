import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { formatCents } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { computeCostToComplete, overrunSummary } from "@/lib/claims";
import { logView } from "@/lib/audit";
import { ModuleHeader } from "@/components/ModuleHeader";
import { BudgetBar, pctUsed, fmtPct } from "@/components/BudgetBar";

/**
 * Overruns — ONLY the cost codes running over budget, worst first.
 *
 * Deliberately narrow: this tab exists so an overrun is impossible to miss and
 * can be sent to a client or QS as the exception report. The full code-by-code
 * position lives on the Budget tab.
 *
 * "Over budget" is measured against the CURRENT budget (original estimate plus
 * APPROVED variations). A code that received an approved variation for extra
 * work is therefore not flagged — only genuine overspend appears. That's the
 * right basis on cost plus: approved growth isn't an overrun.
 */
export default async function OverrunsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  const ctc = await computeCostToComplete(projectId, company);
  await logView(projectId, user, `/projects/${projectId}/overruns`, "Overruns");

  // Shared with the Budget, Cost to Complete and Overview pages so all four
  // report identical overruns on an identical basis.
  const summary = overrunSummary(ctc);
  const over = summary.rows.map((r) => ({ ...r, pct: pctUsed(r.currentCents, r.revisedCents) }));
  const totalOverCents = summary.totalOverCents;
  const netCents = summary.netCents;
  const worst = over[0];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Overruns"
        description={
          isBuilder
            ? "Cost codes spending beyond their current budget, largest first. Approved variations are already counted in the budget, so these are genuine overspends."
            : "Anything costing more than its current budget. Approved variations are already included in the budget, so these are over and above what's been approved."
        }
        action={
          <Link href={`/projects/${projectId}/budget`} className="btn-ghost">
            ← Full budget
          </Link>
        }
      />

      <div className="rounded-md border border-stone-200 bg-stone-100/50 px-4 py-2 text-sm text-stone-600">
        Measured against the current budget — original estimate plus approved variations. All amounts include
        builder&apos;s margin ({company.marginPercent.toFixed(1)}%) and GST ({company.gstPercent.toFixed(0)}%).
      </div>

      {over.length === 0 ? (
        <div className="card border-emerald-500/30">
          <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">✓ Nothing is over budget</p>
          <p className="mt-1 text-sm text-stone-500">
            Every cost code is within its current budget. See the{" "}
            <Link href={`/projects/${projectId}/budget`} className="text-brand underline">Budget tab</Link> for the full
            position.
          </p>
        </div>
      ) : (
        <>
          {/* Headline: how bad, and is it absorbed elsewhere? */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="card border-red-500/30">
              <p className="text-xs uppercase tracking-wide text-stone-400">Total over budget</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-red-700 dark:text-red-300">
                {formatCents(totalOverCents)}
              </p>
              <p className="mt-1 text-xs text-stone-400">
                across {over.length} cost code{over.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="card">
              <p className="text-xs uppercase tracking-wide text-stone-400">Largest overrun</p>
              <p className="mt-2 text-lg font-semibold">{worst.name}</p>
              <p className="mt-1 text-sm tabular-nums text-red-700 dark:text-red-300">
                {formatCents(worst.overCents)} over
              </p>
            </div>
            <div className="card">
              <p className="text-xs uppercase tracking-wide text-stone-400">Whole-job position</p>
              <p
                className={`mt-2 text-lg font-semibold tabular-nums ${
                  netCents < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"
                }`}
              >
                {netCents < 0 ? `${formatCents(-netCents)} over` : `${formatCents(netCents)} remaining`}
              </p>
              <p className="mt-1 text-xs text-stone-400">
                {netCents < 0
                  ? "The overruns are not absorbed by savings elsewhere."
                  : "Underspend elsewhere currently absorbs these overruns."}
              </p>
            </div>
          </div>

          {/* Each overrun, worst first. */}
          <div className="space-y-2">
            {over.map((r) => (
              <div key={r.id} className="card border-red-500/30">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    <span className="font-mono text-xs text-stone-400">{r.code}</span> {r.name}
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-red-700 dark:text-red-300">
                    {formatCents(r.overCents)} over
                    {Number.isFinite(r.pct) && r.revisedCents > 0 && (
                      <span className="ml-1 font-normal">({(r.pct - 100).toFixed(0)}% above budget)</span>
                    )}
                  </p>
                </div>
                <div className="mt-2">
                  <BudgetBar pct={r.pct} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-500 sm:grid-cols-5">
                  <span>Estimate {formatCents(r.estimateCents)}</span>
                  <span>Variations {r.variationsCents !== 0 ? `+${formatCents(r.variationsCents)}` : "—"}</span>
                  <span className="font-medium text-stone-600">Budget {formatCents(r.revisedCents)}</span>
                  <span className="font-medium text-red-700 dark:text-red-300">Spent {formatCents(r.currentCents)}</span>
                  <span>Used {fmtPct(r.pct)}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-stone-400">
            A code shows here only when spend exceeds its budget including approved variations. If extra work was
            approved for it, that money is already in the budget figure above.
          </p>
        </>
      )}

      {/* Unallocated costs can mask an overrun, so flag them here too. */}
      {ctc.unallocated.currentCents !== 0 && (
        <div className="card border-amber-500/30">
          <p className="text-xs uppercase tracking-wide text-stone-400">Unallocated costs</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCents(ctc.unallocated.currentCents)}</p>
          <p className="mt-1 text-xs text-stone-500">
            These sit against no cost code, so they aren&apos;t counted in any overrun above.
            {isBuilder && " Allocate them via “Re-match claim costs” on Cost to Complete for a true picture."}
          </p>
        </div>
      )}
    </div>
  );
}
