import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { formatCents } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { computeCostToComplete } from "@/lib/claims";
import { logView } from "@/lib/audit";
import { ModuleHeader } from "@/components/ModuleHeader";

/**
 * Budget — "where are we against budget, and what has blown out".
 *
 * Deliberately a different question from Cost to Complete (which answers "what
 * is left to spend"). This view is overrun-first: the codes over budget are
 * pulled to the top, sized by how far over, so an overrun is impossible to
 * miss. Original Estimate stays the as-signed baseline on its own tab.
 *
 * Every figure comes from computeCostToComplete — the same single source as the
 * Cost to Complete page and the Overview — so nothing can disagree by a cent.
 */
export default async function BudgetPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  const ctc = await computeCostToComplete(projectId, company);
  await logView(projectId, user, `/projects/${projectId}/budget`, "Budget");

  // A code only counts as spent-against if it has costs OR a budget.
  const rows = ctc.rows
    .filter((r) => r.revisedCents !== 0 || r.currentCents !== 0)
    .map((r) => ({
      ...r,
      // Positive = over budget. (variance is revised - current.)
      overCents: -r.varianceCents,
      pctUsed: r.revisedCents > 0 ? (r.currentCents / r.revisedCents) * 100 : r.currentCents > 0 ? Infinity : 0,
    }));

  const over = rows.filter((r) => r.overCents > 0).sort((a, b) => b.overCents - a.overCents);
  const within = rows.filter((r) => r.overCents <= 0).sort((a, b) => b.pctUsed - a.pctUsed);

  const totalOverCents = over.reduce((a, r) => a + r.overCents, 0);
  const t = ctc.totals;
  // Net position across the whole job (negative = over budget overall).
  const netCents = t.revisedCents - t.currentCents;
  const pctUsed = t.revisedCents > 0 ? (t.currentCents / t.revisedCents) * 100 : 0;

  const headline = [
    { label: "Original estimate", value: t.estimateCents, tone: "" },
    { label: "Approved variations", value: t.variationsCents, tone: "" },
    { label: "Current budget", value: t.revisedCents, tone: "", strong: true },
    { label: "Spent to date", value: t.currentCents, tone: "" },
    {
      label: netCents < 0 ? "Over budget" : "Remaining",
      value: Math.abs(netCents),
      tone: netCents < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300",
      strong: true,
    },
  ];

  /** Spend bar: fills to % of budget used, turns red past 100%. */
  function Bar({ pct, over }: { pct: number; over: boolean }) {
    const width = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 100;
    return (
      <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100">
        <div
          className={`h-full rounded-full ${over ? "bg-red-500" : pct >= 90 ? "bg-amber-500" : "bg-brand"}`}
          style={{ width: `${width}%` }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Budget"
        description={
          isBuilder
            ? "Current budget (estimate + approved variations) against costs incurred, with overruns surfaced first."
            : "How your budget is tracking, trade by trade. Anything running over is shown at the top."
        }
        action={
          <Link href={`/projects/${projectId}/cost-to-complete`} className="btn-ghost">
            Cost to Complete →
          </Link>
        }
      />

      <div className="rounded-md border border-stone-200 bg-stone-100/50 px-4 py-2 text-sm text-stone-600">
        All amounts include builder&apos;s margin ({company.marginPercent.toFixed(1)}%) and GST ({company.gstPercent.toFixed(0)}%).
        The current budget is the original estimate plus approved variations only.
      </div>

      {/* Headline position */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {headline.map((h) => (
          <div key={h.label} className="card">
            <p className="text-xs uppercase tracking-wide text-stone-400">{h.label}</p>
            <p className={`mt-2 tabular-nums ${h.strong ? "text-xl font-semibold" : "text-lg"} ${h.tone}`}>
              {formatCents(h.value)}
            </p>
          </div>
        ))}
      </div>

      {/* Whole-job spend bar */}
      <div className="card">
        <div className="flex items-end justify-between">
          <p className="text-xs uppercase tracking-wide text-stone-400">Budget used</p>
          <p className={`text-2xl font-semibold ${netCents < 0 ? "text-red-700 dark:text-red-300" : ""}`}>
            {pctUsed.toFixed(1)}%
          </p>
        </div>
        <div className="mt-3">
          <Bar pct={pctUsed} over={netCents < 0} />
        </div>
        <p className="mt-2 text-xs text-stone-400">
          {formatCents(t.currentCents)} of {formatCents(t.revisedCents)}
          {netCents < 0 && <span className="text-red-700 dark:text-red-300"> · {formatCents(-netCents)} over</span>}
        </p>
      </div>

      {/* ── OVERRUNS, worst first ── */}
      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">
            Over budget{over.length > 0 && <span className="ml-2 text-sm font-normal text-stone-400">{over.length} cost code{over.length === 1 ? "" : "s"}</span>}
          </h2>
          {over.length > 0 && (
            <span className="text-sm font-semibold text-red-700 dark:text-red-300">
              {formatCents(totalOverCents)} over in total
            </span>
          )}
        </div>

        {over.length === 0 ? (
          <div className="card text-sm text-emerald-700 dark:text-emerald-300">
            ✓ Nothing is over budget. Every cost code is within its allowance.
          </div>
        ) : (
          <div className="space-y-2">
            {over.map((r) => (
              <div key={r.id} className="card border-red-500/30">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    <span className="font-mono text-xs text-stone-400">{r.code}</span> {r.name}
                  </p>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300 tabular-nums">
                    {formatCents(r.overCents)} over
                    {Number.isFinite(r.pctUsed) && r.revisedCents > 0 && (
                      <span className="ml-1 font-normal">({(r.pctUsed - 100).toFixed(0)}%)</span>
                    )}
                  </p>
                </div>
                <div className="mt-2">
                  <Bar pct={r.pctUsed} over />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-500 sm:grid-cols-4">
                  <span>Estimate {formatCents(r.estimateCents)}</span>
                  <span>Variations {r.variationsCents !== 0 ? `+${formatCents(r.variationsCents)}` : "—"}</span>
                  <span className="font-medium text-stone-600">Budget {formatCents(r.revisedCents)}</span>
                  <span className="font-medium text-red-700 dark:text-red-300">Spent {formatCents(r.currentCents)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── WITHIN BUDGET, closest to the limit first ── */}
      {within.length > 0 && (
        <div>
          <h2 className="mb-3 font-semibold">
            Within budget <span className="ml-1 text-sm font-normal text-stone-400">{within.length} cost code{within.length === 1 ? "" : "s"}</span>
          </h2>
          <div className="card p-0">
            <table className="w-full table-fixed text-xs sm:text-sm">
              <colgroup>
                <col className="w-[9%]" /><col className="w-[27%]" /><col className="w-[16%]" />
                <col className="w-[16%]" /><col className="w-[16%]" /><col className="w-[16%]" />
              </colgroup>
              <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-2 py-2.5">Code</th>
                  <th className="px-2 py-2.5">Cost item</th>
                  <th className="px-2 py-2.5 text-right">Budget</th>
                  <th className="px-2 py-2.5 text-right">Spent</th>
                  <th className="px-2 py-2.5 text-right">Remaining</th>
                  <th className="px-2 py-2.5">Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 align-top">
                {within.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-2 font-mono text-xs text-stone-400 whitespace-nowrap">{r.code}</td>
                    <td className="px-2 py-2 break-words">{r.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{formatCents(r.revisedCents)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{formatCents(r.currentCents)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-emerald-700 dark:text-emerald-300">
                      {formatCents(-r.overCents)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <Bar pct={r.pctUsed} over={false} />
                        <span className="w-10 shrink-0 text-right tabular-nums text-stone-500">
                          {Number.isFinite(r.pctUsed) ? `${r.pctUsed.toFixed(0)}%` : "—"}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Unallocated costs, if any — money that hasn't been matched to a code. */}
      {ctc.unallocated.currentCents !== 0 && (
        <div className="card border-amber-500/30">
          <p className="text-xs uppercase tracking-wide text-stone-400">Unallocated costs</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCents(ctc.unallocated.currentCents)}</p>
          <p className="mt-1 text-xs text-stone-500">
            Costs not yet matched to a cost code, so they don&apos;t appear against any budget above.
            {isBuilder && " Use “Re-match claim costs” on Cost to Complete to allocate them."}
          </p>
        </div>
      )}
    </div>
  );
}
