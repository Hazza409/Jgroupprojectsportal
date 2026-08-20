import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { formatCents } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { computeCostToComplete, overrunSummary, budgetPosition } from "@/lib/claims";
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

  // A published line forecast ADJUSTS the line's working budget: the Used bar
  // reads against what the line is now expected to finish at, not the figure
  // everyone already knows it will pass. Same rule as the whole-job bar (§2),
  // applied per row. No forecast → the approved budget stands.
  const rows = ctc.rows.map((r) => {
    const workingBudgetCents = r.forecastCents ?? r.revisedCents;
    return {
      ...r,
      workingBudgetCents,
      // Forecast wins over raw spend — same basis as the Adjustments tab.
      over: r.forecastMovementCents !== null ? r.forecastMovementCents > 0 : r.currentCents > r.revisedCents,
      pct: pctUsed(r.currentCents, workingBudgetCents),
    };
  });
  // Shared basis with the Overruns / Cost to Complete / Overview pages.
  const summary = overrunSummary(ctc);
  const overCount = summary.count;
  const totalOverCents = summary.totalOverCents;
  const watchCount = rows.filter((r) => !r.over && Number.isFinite(r.pct) && r.pct >= 90).length;

  const t = ctc.totals;
  // Remaining counts against the FORECAST, not the estimate (Jake §2) — on cost
  // plus the estimate was never a pot to draw down.
  const pos = await budgetPosition(projectId, ctc);
  const remaining = pos.remainingToForecastCents;
  const jobPct = pos.pctOfForecast;

  const headline = [
    { label: "Original estimate", value: pos.estimateCents },
    { label: "Approved variations", value: pos.variationsCents },
    { label: "Approved budget", value: pos.approvedBudgetCents, strong: true },
    { label: "Forecast final cost", value: pos.forecastCents, strong: true },
    { label: "Spent to date", value: pos.spentCents },
    {
      label: remaining < 0 ? "Above forecast" : "Remaining to forecast",
      value: Math.abs(remaining),
      strong: true,
      // Amber, not red: passing the forecast is information the client needs,
      // not a breach of a committed figure.
      tone: remaining < 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300",
    },
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Budget"
        description={
          isBuilder
            ? "Approved budget (estimate + approved variations) and forecast final cost against costs incurred, for every cost code."
            : "What each part of the build is estimated to cost, what it's forecast to finish at, and what's been spent so far."
        }
        action={
          <Link href={`/projects/${projectId}/overruns`} className="btn-ghost">
            Forecast Adjustments →
          </Link>
        }
      />

      <div className="space-y-2 rounded-md border border-stone-200 bg-stone-100/50 px-4 py-2 text-sm text-stone-600">
        <p>
          All amounts include builder&apos;s margin ({company.marginPercent.toFixed(1)}%) and GST ({company.gstPercent.toFixed(0)}%).
          {/* The rate is company-wide, so it lives in Builder settings, not here.
              Linking it saves hunting for where the number on this line comes from. */}
          {isBuilder && (
            <>
              {" "}
              <Link href="/builder/settings" className="underline underline-offset-2">Change the rate</Link>
            </>
          )}
        </p>
        {/*
          Standing disclaimer, wording supplied verbatim by Jake (§6). Its whole
          purpose is to sit in front of the client every time they open the page,
          so it must never be behind a role check or a dismiss button.
        */}
        <p>
          Estimates are not a fixed price. Each cost line is an estimate that is reforecast against actual
          cost as the build progresses. The current approved budget is the original estimate plus approved
          variations only, and is not a cap on final cost.
        </p>
      </div>

      {/* Headline position */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {headline.map((h) => (
          <div key={h.label} className="card">
            <p className="text-xs uppercase tracking-wide text-stone-400">{h.label}</p>
            <p className={`mt-2 tabular-nums ${h.strong ? "text-xl font-semibold" : "text-lg"} ${h.tone ?? ""}`}>
              {formatCents(h.value)}
            </p>
          </div>
        ))}
      </div>

      {/* Spend against FORECAST, not against the estimate (Jake §2). */}
      <div className="card">
        <div className="flex items-end justify-between">
          <p className="text-xs uppercase tracking-wide text-stone-400">Spent against forecast</p>
          <p className={`text-2xl font-semibold ${remaining < 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>
            {fmtPct(jobPct)}
          </p>
        </div>
        <div className="mt-3">
          <BudgetBar pct={jobPct} thick />
        </div>
        <p className="mt-2 text-xs text-stone-400">
          {formatCents(pos.spentCents)} of {formatCents(pos.forecastCents)} forecast
          {remaining < 0 && (
            <span className="text-amber-700 dark:text-amber-300"> · {formatCents(-remaining)} above forecast</span>
          )}
          {!pos.forecastIsPublished && (
            <>
              {" · "}
              <span>
                no forecast published yet, so this reads against the approved budget
                {isBuilder && " — publish one in Settings"}
              </span>
            </>
          )}
        </p>
      </div>

      {/*
        Wording per Jake §4: "above its original estimate", never "over budget".
        Amber, not red — a cost movement is information, not a breach.
      */}
      {overCount > 0 && (
        <Link
          href={`/projects/${projectId}/overruns`}
          className="card flex flex-wrap items-center justify-between gap-2 border-amber-500/40 hover:shadow-md"
        >
          <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {overCount} cost code{overCount === 1 ? " is" : "s are"} forecast above{" "}
            {overCount === 1 ? "its" : "their"} original estimate by {formatCents(totalOverCents)}
          </span>
          <span className="text-sm text-stone-500">See the Forecast Adjustments tab →</span>
        </Link>
      )}
      {overCount === 0 && (
        <div className="card border-emerald-500/30 text-sm text-emerald-700 dark:text-emerald-300">
          ✓ Every cost code is tracking at or below its estimate.
          {watchCount > 0 && (
            <span className="text-stone-500">
              {" "}
              {watchCount} code{watchCount === 1 ? "" : "s"} at 90% or more of estimate — shown in amber below.
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
              <col className="w-[7%]" /><col className="w-[19%]" /><col className="w-[12%]" />
              <col className="w-[11%]" /><col className="w-[12%]" /><col className="w-[12%]" />
              <col className="w-[12%]" /><col className="w-[15%]" />
            </colgroup>
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-2 py-2.5">Code</th>
                <th className="px-2 py-2.5">Cost item</th>
                <th className="px-2 py-2.5 text-right">Estimate</th>
                <th className="px-2 py-2.5 text-right">Variations</th>
                <th className="px-2 py-2.5 text-right">Approved budget</th>
                <th className="px-2 py-2.5 text-right">Forecast</th>
                <th className="px-2 py-2.5 text-right">Spent</th>
                <th className="px-2 py-2.5">Used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 align-top">
              {rows.map((r) => {
                // "above estimate", flagged amber. Never red from spend alone
                // (Jake §3): a front-loaded line early in the job is not a
                // blowout, and red here reads as a self-reported failure.
                const over = r.over;
                return (
                  <tr key={r.id} className={over ? "bg-amber-500/5" : undefined}>
                    <td className="px-2 py-2 font-mono text-xs text-stone-400 whitespace-nowrap">{r.code}</td>
                    <td className="px-2 py-2 break-words">{r.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{formatCents(r.estimateCents)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-stone-500">
                      {r.variationsCents !== 0 ? `+${formatCents(r.variationsCents)}` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap font-medium">{formatCents(r.revisedCents)}</td>
                    <td
                      className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${
                        r.forecastCents !== null ? "font-medium" : "text-stone-400"
                      }`}
                      title={r.forecastNote ?? undefined}
                    >
                      {r.forecastCents !== null ? formatCents(r.forecastCents) : "—"}
                    </td>
                    <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${over ? "font-medium text-amber-800 dark:text-amber-200" : ""}`}>
                      {formatCents(r.currentCents)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <BudgetBar pct={r.pct} />
                        <span className={`w-9 shrink-0 text-right tabular-nums ${over ? "text-amber-800 dark:text-amber-200" : "text-stone-500"}`}>
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
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap text-stone-400">—</td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{formatCents(t.currentCents)}</td>
                <td className="px-2 py-2.5 tabular-nums text-stone-500">{fmtPct(jobPct)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rows.some((r) => r.forecastCents !== null) && (
        <p className="text-xs text-stone-400">
          Where a forecast has been published for a cost line, its Used bar reads against that forecast —
          the line&apos;s current expected final cost — rather than the approved budget. The reasons are on
          the Forecast Adjustments tab.
        </p>
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
