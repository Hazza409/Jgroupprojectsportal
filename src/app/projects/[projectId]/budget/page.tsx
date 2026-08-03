import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { formatCents } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { computeCostToComplete, overrunSummary } from "@/lib/claims";
import { logView } from "@/lib/audit";
import { ModuleHeader } from "@/components/ModuleHeader";
import { BudgetBar, pctUsed, fmtPct } from "@/components/BudgetBar";

/**
 * Budget — the FULL picture: every cost code, its budget, what's been spent,
 * and how much of the budget is used. Original Estimate stays the as-signed
 * baseline; overruns get their own tab (linked from the banner here).
 *
 * Every figure comes from computeCostToComplete — the same single source as the
 * Overruns tab, Cost to Complete and the Overview — so nothing can disagree.
 */
export default async function BudgetPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  const ctc = await computeCostToComplete(projectId, company);
  await logView(projectId, user, `/projects/${projectId}/budget`, "Budget");

  const rows = ctc.rows.map((r) => ({
    ...r,
    overCents: -r.varianceCents, // positive = over budget
    pct: pctUsed(r.currentCents, r.revisedCents),
  }));
  // Shared basis with the Overruns / Cost to Complete / Overview pages.
  const summary = overrunSummary(ctc);
  const overCount = summary.count;
  const totalOverCents = summary.totalOverCents;
  const watchCount = rows.filter((r) => r.overCents <= 0 && Number.isFinite(r.pct) && r.pct >= 90).length;

  const t = ctc.totals;
  const netCents = t.revisedCents - t.currentCents; // negative = over overall
  const jobPct = pctUsed(t.currentCents, t.revisedCents);

  const headline = [
    { label: "Original estimate", value: t.estimateCents },
    { label: "Approved variations", value: t.variationsCents },
    { label: "Current budget", value: t.revisedCents, strong: true },
    { label: "Spent to date", value: t.currentCents },
    {
      label: netCents < 0 ? "Over budget" : "Remaining",
      value: Math.abs(netCents),
      strong: true,
      tone: netCents < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300",
    },
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Budget"
        description={
          isBuilder
            ? "Current budget (estimate + approved variations) against costs incurred, for every cost code."
            : "Your budget for each part of the build, and how much of it has been spent."
        }
        action={
          <Link href={`/projects/${projectId}/overruns`} className="btn-ghost">
            Overruns →
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
            <p className={`mt-2 tabular-nums ${h.strong ? "text-xl font-semibold" : "text-lg"} ${h.tone ?? ""}`}>
              {formatCents(h.value)}
            </p>
          </div>
        ))}
      </div>

      {/* Whole-job budget used */}
      <div className="card">
        <div className="flex items-end justify-between">
          <p className="text-xs uppercase tracking-wide text-stone-400">Budget used</p>
          <p className={`text-2xl font-semibold ${netCents < 0 ? "text-red-700 dark:text-red-300" : ""}`}>
            {fmtPct(jobPct)}
          </p>
        </div>
        <div className="mt-3">
          <BudgetBar pct={jobPct} thick />
        </div>
        <p className="mt-2 text-xs text-stone-400">
          {formatCents(t.currentCents)} of {formatCents(t.revisedCents)}
          {netCents < 0 && <span className="text-red-700 dark:text-red-300"> · {formatCents(-netCents)} over</span>}
        </p>
      </div>

      {/* Pointer to the Overruns tab — the detail lives there, not here. */}
      {overCount > 0 && (
        <Link
          href={`/projects/${projectId}/overruns`}
          className="card flex flex-wrap items-center justify-between gap-2 border-red-500/30 hover:shadow-md"
        >
          <span className="text-sm font-medium text-red-700 dark:text-red-300">
            {overCount} cost code{overCount === 1 ? " is" : "s are"} over budget by {formatCents(totalOverCents)}
          </span>
          <span className="text-sm text-stone-500">See the Overruns tab →</span>
        </Link>
      )}
      {overCount === 0 && (
        <div className="card border-emerald-500/30 text-sm text-emerald-700 dark:text-emerald-300">
          ✓ Nothing is over budget.
          {watchCount > 0 && (
            <span className="text-stone-500">
              {" "}
              {watchCount} code{watchCount === 1 ? "" : "s"} at 90% or more of budget — shown in amber below.
            </span>
          )}
        </div>
      )}

      {/* Every cost code, in code order. */}
      {rows.length === 0 ? (
        <div className="card text-stone-500">No cost codes yet. Import an estimate first.</div>
      ) : (
        <div className="card p-0">
          <table className="w-full table-fixed text-xs sm:text-sm">
            <colgroup>
              <col className="w-[8%]" /><col className="w-[22%]" /><col className="w-[13%]" />
              <col className="w-[12%]" /><col className="w-[13%]" /><col className="w-[13%]" />
              <col className="w-[19%]" />
            </colgroup>
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-2 py-2.5">Code</th>
                <th className="px-2 py-2.5">Cost item</th>
                <th className="px-2 py-2.5 text-right">Estimate</th>
                <th className="px-2 py-2.5 text-right">Variations</th>
                <th className="px-2 py-2.5 text-right">Budget</th>
                <th className="px-2 py-2.5 text-right">Spent</th>
                <th className="px-2 py-2.5">Used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 align-top">
              {rows.map((r) => {
                const over = r.overCents > 0;
                return (
                  <tr key={r.id} className={over ? "bg-red-500/5" : undefined}>
                    <td className="px-2 py-2 font-mono text-xs text-stone-400 whitespace-nowrap">{r.code}</td>
                    <td className="px-2 py-2 break-words">{r.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{formatCents(r.estimateCents)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-stone-500">
                      {r.variationsCents !== 0 ? `+${formatCents(r.variationsCents)}` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap font-medium">{formatCents(r.revisedCents)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${over ? "font-medium text-red-700 dark:text-red-300" : ""}`}>
                      {formatCents(r.currentCents)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <BudgetBar pct={r.pct} />
                        <span className={`w-9 shrink-0 text-right tabular-nums ${over ? "text-red-700 dark:text-red-300" : "text-stone-500"}`}>
                          {fmtPct(r.pct)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-stone-200 bg-stone-50 font-semibold">
              <tr>
                <td colSpan={2} className="px-2 py-2.5">Total</td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{formatCents(t.estimateCents)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {t.variationsCents !== 0 ? `+${formatCents(t.variationsCents)}` : "—"}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{formatCents(t.revisedCents)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{formatCents(t.currentCents)}</td>
                <td className="px-2 py-2.5 tabular-nums text-stone-500">{fmtPct(jobPct)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Costs not matched to any cost code — they sit against no budget. */}
      {ctc.unallocated.currentCents !== 0 && (
        <div className="card border-amber-500/30">
          <p className="text-xs uppercase tracking-wide text-stone-400">Unallocated costs</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCents(ctc.unallocated.currentCents)}</p>
          <p className="mt-1 text-xs text-stone-500">
            Not yet matched to a cost code, so these sit against no budget above.
            {isBuilder && " Use “Re-match claim costs” on Cost to Complete to allocate them."}
          </p>
        </div>
      )}
    </div>
  );
}
