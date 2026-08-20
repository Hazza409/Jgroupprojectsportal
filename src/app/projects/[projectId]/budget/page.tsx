import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { formatCents, inclMarginGst } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { db } from "@/lib/db";
import { computeCostToComplete, overrunSummary, budgetPosition, claimHeadlineCents } from "@/lib/claims";
import { logView } from "@/lib/audit";
import { ModuleHeader } from "@/components/ModuleHeader";
import { BudgetBar, pctUsed, fmtPct } from "@/components/BudgetBar";
import { isConnected } from "@/lib/xero/tokens";
import { XeroControls } from "../cost-to-complete/XeroControls";
import { CurrentCostsImport } from "../cost-to-complete/CurrentCostsImport";
import { rematchClaimCosts } from "../cost-to-complete/actions";

/**
 * Budget — THE money page. The old Cost to Complete tab is folded in here
 * (Harry, 21 Aug 2026): its builder tools (Xero sync, cost import, re-match,
 * Excel export), the pending-claims panel and the unallocated diagnostics all
 * live on this page now, and /cost-to-complete redirects here.
 *
 * Column design: the forecast shows as the ADJUSTMENT — the signed difference
 * against the approved budget — sitting left of the budget column. Five
 * full-size money columns in a row made every line a wall of similar numbers;
 * the delta is the fact a reader actually wants.
 *
 * Every figure comes from computeCostToComplete — the same single source as
 * Forecast Adjustments and the Overview — so nothing can disagree.
 */
export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: { projectId: string };
  searchParams: { xero?: string };
}) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  const [ctc, xeroConnected, xeroConn, pendingClaims, unallocatedSources] = await Promise.all([
    computeCostToComplete(projectId, company),
    isBuilder ? isConnected(projectId) : Promise.resolve(false),
    isBuilder
      ? db.xeroConnection.findUnique({ where: { projectId }, select: { lastSyncedAt: true } })
      : Promise.resolve(null),
    // Claims entered but not yet posted — costs reach these figures on
    // APPROVAL, and without this panel the page is silent about the most
    // common question: "I put the invoice in, why hasn't spend moved?"
    isBuilder
      ? db.progressClaim.findMany({
          where: { projectId, status: { in: ["DRAFT", "SUBMITTED"] } },
          orderBy: { claimNumber: "asc" },
          select: {
            id: true, claimNumber: true, status: true, periodLabel: true,
            totalCents: true, lines: { select: { claimedAmountCents: true } },
          },
        })
      : Promise.resolve([]),
    // WHY money sits in Unallocated — the two causes need opposite fixes.
    isBuilder
      ? db.costActual.findMany({
          where: { projectId, costCodeId: null, amountCents: { not: 0 } },
          orderBy: { amountCents: "desc" },
          select: { id: true, description: true, amountCents: true, xeroSourceId: true },
        })
      : Promise.resolve([]),
    logView(projectId, user, `/projects/${projectId}/budget`, "Budget"),
  ]);

  const pending = pendingClaims
    .map((c) => ({ ...c, headline: claimHeadlineCents(c, company) }))
    .filter((c) => c.headline > 0);
  const pendingTotal = pending.reduce((a, c) => a + c.headline, 0);
  const unmatchedNames = unallocatedSources.filter((a) => !a.xeroSourceId?.endsWith(":remainder"));
  const unitemised = unallocatedSources.filter((a) => a.xeroSourceId?.endsWith(":remainder"));

  // A published line forecast ADJUSTS the line's working budget: the Used bar
  // reads against what the line is now expected to finish at. No forecast →
  // the approved budget stands.
  const rows = ctc.rows.map((r) => {
    const workingBudgetCents = r.forecastCents ?? r.revisedCents;
    return {
      ...r,
      workingBudgetCents,
      // Signed adjustment against the approved budget — what the table shows.
      adjustmentCents: r.forecastCents !== null ? r.forecastCents - r.revisedCents : null,
      over: r.forecastMovementCents !== null ? r.forecastMovementCents > 0 : r.currentCents > r.revisedCents,
      pct: pctUsed(r.currentCents, workingBudgetCents),
    };
  });
  const netAdjustmentCents = rows.reduce((a, r) => a + (r.adjustmentCents ?? 0), 0);
  const anyForecast = rows.some((r) => r.adjustmentCents !== null);

  const summary = overrunSummary(ctc);
  const overCount = summary.count;
  const totalOverCents = summary.totalOverCents;
  const watchCount = rows.filter((r) => !r.over && Number.isFinite(r.pct) && r.pct >= 90).length;

  const t = ctc.totals;
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
      tone: remaining < 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300",
    },
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Budget"
        description={
          isBuilder
            ? "The whole money position: approved budget, forecast adjustments and costs incurred, per cost code. Current costs sync one-directionally from Xero."
            : "What each part of the build is estimated to cost, what it's forecast to finish at, and what's been spent so far."
        }
        action={
          <Link href={`/projects/${projectId}/overruns`} className="btn-ghost">
            Forecast Adjustments →
          </Link>
        }
      />

      {/* ── Builder tools, folded in from the old Cost to Complete tab ── */}
      {isBuilder && (
        <div className="flex flex-wrap items-start gap-2">
          <XeroControls
            projectId={projectId}
            connected={xeroConnected}
            lastSyncedAt={
              xeroConn?.lastSyncedAt
                ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(
                    xeroConn.lastSyncedAt,
                  )
                : null
            }
          />
          <CurrentCostsImport projectId={projectId} />
          {/* Re-links approved claims' lines to cost codes (fuzzy) + re-posts them. */}
          <form action={rematchClaimCosts.bind(null, projectId)}>
            <button className="btn-ghost" type="submit">Re-match claim costs</button>
          </form>
          <a className="btn-ghost" href={`/api/projects/${projectId}/export`}>Export to Excel</a>
        </div>
      )}

      {searchParams.xero === "connected" && (
        <div className="card border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-700 dark:text-emerald-200">
          Xero connected. Click <strong>Sync now</strong> to pull current costs.
        </div>
      )}
      {searchParams.xero === "error" && (
        <div className="card border-red-500/30 bg-red-500/10 text-sm text-red-700 dark:text-red-200">
          Xero connection failed. Check your app credentials and try again.
        </div>
      )}

      <div className="space-y-2 rounded-md border border-stone-200 bg-stone-100/50 px-4 py-2 text-sm text-stone-600">
        <p>
          All amounts include builder&apos;s margin ({company.marginPercent.toFixed(1)}%) and GST ({company.gstPercent.toFixed(0)}%).
          {isBuilder && (
            <>
              {" "}
              <Link href="/builder/settings" className="underline underline-offset-2">Change the rate</Link>
            </>
          )}
        </p>
        {/* Jake §6, verbatim — never behind a role check or a dismiss button. */}
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
                {isBuilder && " — publish one on Forecast Adjustments"}
              </span>
            </>
          )}
        </p>
      </div>

      {/* Claims entered but not yet in these figures (was on Cost to Complete). */}
      {isBuilder && pending.length > 0 && (
        <div className="card border-amber-500/40 bg-amber-500/10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {formatCents(pendingTotal)} claimed but not yet in these figures
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-200/80">
              Claim costs post to Spent when the claim is approved.
            </p>
          </div>
          <ul className="mt-3 divide-y divide-amber-500/20">
            {pending.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                <Link
                  href={`/projects/${projectId}/progress-claims/${c.id}`}
                  className="font-medium underline underline-offset-2"
                >
                  Claim #{c.claimNumber}
                  {c.periodLabel ? ` — ${c.periodLabel}` : ""}
                </Link>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatCents(c.headline)}</span>
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900 dark:text-amber-100">
                    {c.status === "SUBMITTED" ? "Awaiting client" : "Draft"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Wording per Jake §4: "above estimate", amber, never "over budget". */}
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
              <col className="w-[7%]" /><col className="w-[20%]" /><col className="w-[12%]" />
              <col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[12%]" />
              <col className="w-[12%]" /><col className="w-[15%]" />
            </colgroup>
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-2 py-2.5">Code</th>
                <th className="px-2 py-2.5">Cost item</th>
                <th className="px-2 py-2.5 text-right">Estimate</th>
                <th className="px-2 py-2.5 text-right">Variations</th>
                {/*
                  The forecast as a DELTA, left of the budget it adjusts. The
                  full forecast figure lives on Forecast Adjustments; here the
                  signed difference is the fact the reader wants, and it spares
                  the table a fifth full-size money column.
                */}
                <th className="px-2 py-2.5 text-right">Forecast adj.</th>
                {/*
                  Estimate + Variations + Forecast adj. = this column, row by
                  row. It is NOT the approved budget once an adjustment is
                  published (Jake §5: approved budget = estimate + approved
                  variations only) — it is the line's forecast budget, and it
                  equals the approved budget when nothing is forecast.
                */}
                <th className="px-2 py-2.5 text-right">Forecast budget</th>
                <th className="px-2 py-2.5 text-right">Spent</th>
                <th className="px-2 py-2.5">Used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 align-top">
              {rows.map((r) => {
                const over = r.over;
                return (
                  <tr key={r.id} className={over ? "bg-amber-500/5" : undefined}>
                    <td className="px-2 py-2 font-mono text-xs text-stone-400 whitespace-nowrap">{r.code}</td>
                    <td className="px-2 py-2 break-words">{r.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{formatCents(r.estimateCents)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-stone-500">
                      {r.variationsCents !== 0 ? `+${formatCents(r.variationsCents)}` : "—"}
                    </td>
                    <td
                      className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${
                        r.adjustmentCents === null
                          ? "text-stone-400"
                          : r.adjustmentCents > 0
                            ? "font-medium text-amber-800 dark:text-amber-200"
                            : "font-medium text-emerald-700 dark:text-emerald-300"
                      }`}
                      title={r.forecastNote ?? undefined}
                    >
                      {r.adjustmentCents === null
                        ? "—"
                        : `${r.adjustmentCents >= 0 ? "+" : "−"}${formatCents(Math.abs(r.adjustmentCents))}`}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap font-medium">{formatCents(r.workingBudgetCents)}</td>
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
                <td
                  className={`px-2 py-2.5 text-right tabular-nums whitespace-nowrap ${
                    !anyForecast ? "text-stone-400" : netAdjustmentCents > 0 ? "text-amber-800 dark:text-amber-200" : "text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {anyForecast
                    ? `${netAdjustmentCents >= 0 ? "+" : "−"}${formatCents(Math.abs(netAdjustmentCents))}`
                    : "—"}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{formatCents(t.revisedCents + netAdjustmentCents)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{formatCents(t.currentCents)}</td>
                <td className="px-2 py-2.5 tabular-nums text-stone-500">{fmtPct(jobPct)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {anyForecast && (
        <p className="text-xs text-stone-400">
          Estimate + Variations + Forecast adj. = Forecast budget, row by row. Where no adjustment is
          published, the forecast budget simply equals the approved budget (estimate plus approved
          variations). Adjustments are amber when a line is forecast to finish above its approved budget,
          green when below; the Used bar reads against the forecast budget. Full figures and reasons are on
          the Forecast Adjustments tab.
        </p>
      )}

      {/* WHY money is unallocated (was on Cost to Complete). Builder detail;
          clients get the plain one-liner. */}
      {ctc.unallocated.currentCents !== 0 && (
        <div className="card border-amber-500/30">
          <p className="text-xs uppercase tracking-wide text-stone-400">Unallocated costs</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCents(ctc.unallocated.currentCents)}</p>
          {!isBuilder && (
            <p className="mt-1 text-xs text-stone-500">
              Not yet matched to a cost code, so these sit against no budget above.
            </p>
          )}
          {isBuilder && unitemised.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Not itemised on the sheet</p>
              <p className="mt-1 text-sm text-stone-500">
                These claims had no Budget Overview rows, so there was nothing to split their costs by.
                Re-import the sheet with that section present.
              </p>
              <ul className="mt-2 space-y-1">
                {unitemised.map((u) => (
                  <li key={u.id} className="flex justify-between gap-3 text-sm">
                    <span>{u.description}</span>
                    <span className="tabular-nums">{formatCents(inclMarginGst(u.amountCents, company))}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {isBuilder && unmatchedNames.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">No matching cost code</p>
              <p className="mt-1 text-sm text-stone-500">
                These lines parsed, but their names match no cost code on this job. Rename at either end so
                they agree, then press <strong>Re-match claim costs</strong> above.
              </p>
              <ul className="mt-2 space-y-1">
                {unmatchedNames.slice(0, 15).map((u) => (
                  <li key={u.id} className="flex justify-between gap-3 text-sm">
                    <span>{u.description}</span>
                    <span className="tabular-nums">{formatCents(inclMarginGst(u.amountCents, company))}</span>
                  </li>
                ))}
              </ul>
              {unmatchedNames.length > 15 && (
                <p className="mt-1 text-xs text-stone-400">+ {unmatchedNames.length - 15} more</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
