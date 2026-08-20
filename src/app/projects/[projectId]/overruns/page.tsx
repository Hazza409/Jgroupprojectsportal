import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { formatCents } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { computeCostToComplete, overrunSummary } from "@/lib/claims";
import { correctCostName } from "@/lib/houseStyle";
import { forecastGate } from "@/lib/forecast";
import { db } from "@/lib/db";
import { LineForecastEditor, type ForecastLine } from "@/components/LineForecastEditor";
import { logView } from "@/lib/audit";
import { ModuleHeader } from "@/components/ModuleHeader";
import { BudgetBar, pctUsed, fmtPct } from "@/components/BudgetBar";

/**
 * Forecast Adjustments — ONLY the cost codes tracking above their estimate, largest
 * first. (Route stays /overruns: Jake §4 changes the labels, not the data or
 * any existing link.)
 *
 * Deliberately narrow: this tab exists so a movement is impossible to miss and
 * can be sent to a client or QS as the exception report. The full code-by-code
 * position lives on the Budget tab.
 *
 * Measured against the APPROVED budget (original estimate plus APPROVED
 * variations). A code that received an approved variation for extra work is
 * therefore not flagged — approved growth is not a movement against estimate.
 *
 * Language throughout is "above estimate", never "over budget", and the colour
 * is amber, never red: on cost plus the estimate was never a committed ceiling,
 * so "over budget" misdescribes the figure and reads as an admitted breach.
 */
export default async function OverrunsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  const ctc = await computeCostToComplete(projectId, company);
  await logView(projectId, user, `/projects/${projectId}/overruns`, "Forecast Adjustments");

  // Builder-only: every cost code, with whatever is staged against it, so a
  // movement can be forecast BEFORE the line is over rather than after.
  const gate = isBuilder ? await forecastGate(projectId, company) : null;
  const editorLines: ForecastLine[] = isBuilder
    ? (
        await db.costCode.findMany({
          where: { projectId },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true, pendingForecastCents: true, pendingForecastNote: true },
        })
      ).map((cc) => {
        const row = ctc.rows.find((r) => r.id === cc.id);
        return {
          id: cc.id,
          code: cc.code,
          name: correctCostName(cc.name),
          approvedBudgetCents: row?.revisedCents ?? 0,
          spentCents: row?.currentCents ?? 0,
          publishedForecastCents: row?.forecastCents ?? null,
          // The input takes plain dollars; the stored figure is base cents.
          pendingDollars: cc.pendingForecastCents === null ? "" : (cc.pendingForecastCents / 100).toFixed(2),
          pendingNote: cc.pendingForecastNote ?? "",
        };
      })
    : [];
  const gateNote = !gate
    ? ""
    : gate.unconfigured
      ? "Sign off in Settings to publish"
      : `Publishes once signed off by ${gate.required.join(", ")}`;

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
        title="Forecast Adjustments"
        description={
          isBuilder
            ? "Cost codes tracking above their approved budget, largest first. Approved variations are already counted in the budget, so these are movements against estimate, not approved growth."
            : "Where costs are currently running above the original estimate for that item. Estimates are reforecast as the build progresses — these are not extra charges beyond what's been approved."
        }
        action={
          <Link href={`/projects/${projectId}/budget`} className="btn-ghost">
            ← Full budget
          </Link>
        }
      />

      <div className="rounded-md border border-stone-200 bg-stone-100/50 px-4 py-2 text-sm text-stone-600">
        Measured against the approved budget — original estimate plus approved variations, which is not a cap
        on final cost. All amounts include builder&apos;s margin ({company.marginPercent.toFixed(1)}%) and GST ({company.gstPercent.toFixed(0)}%).
      </div>

      {isBuilder && editorLines.length > 0 && (
        <LineForecastEditor projectId={projectId} lines={editorLines} gateNote={gateNote} />
      )}

      {over.length === 0 ? (
        <div className="card border-emerald-500/30">
          <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">✓ Every cost code is tracking at or below its estimate</p>
          <p className="mt-1 text-sm text-stone-500">
            Nothing is currently running above its approved budget. See the{" "}
            <Link href={`/projects/${projectId}/budget`} className="text-brand underline">Budget tab</Link> for the full
            position.
          </p>
        </div>
      ) : (
        <>
          {/* Headline: how bad, and is it absorbed elsewhere? */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="card border-amber-500/40">
              <p className="text-xs uppercase tracking-wide text-stone-400">Total above estimate</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-amber-800 dark:text-amber-200">
                {formatCents(totalOverCents)}
              </p>
              <p className="mt-1 text-xs text-stone-400">
                across {over.length} cost code{over.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="card">
              <p className="text-xs uppercase tracking-wide text-stone-400">Largest movement</p>
              <p className="mt-2 text-lg font-semibold">{worst.name}</p>
              <p className="mt-1 text-sm tabular-nums text-amber-800 dark:text-amber-200">
                {formatCents(worst.overCents)} above estimate
              </p>
            </div>
            <div className="card">
              <p className="text-xs uppercase tracking-wide text-stone-400">Whole-job position</p>
              <p
                className={`mt-2 text-lg font-semibold tabular-nums ${
                  netCents < 0 ? "text-amber-800 dark:text-amber-200" : "text-emerald-700 dark:text-emerald-300"
                }`}
              >
                {netCents < 0 ? `${formatCents(-netCents)} above` : `${formatCents(netCents)} remaining`}
              </p>
              <p className="mt-1 text-xs text-stone-400">
                {netCents < 0
                  ? "These movements are not currently offset elsewhere."
                  : "Movement elsewhere currently offsets these."}
              </p>
            </div>
          </div>

          {/* Each overrun, worst first. */}
          <div className="space-y-2">
            {over.map((r) => (
              <div key={r.id} className="card border-amber-500/40">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    <span className="font-mono text-xs text-stone-400">{r.code}</span> {r.name}
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-amber-800 dark:text-amber-200">
                    {formatCents(r.overCents)} above estimate
                    {r.basis === "spend" && Number.isFinite(r.pct) && r.revisedCents > 0 && (
                      <span className="ml-1 font-normal">({(r.pct - 100).toFixed(0)}% above)</span>
                    )}
                  </p>
                </div>
                <div className="mt-2">
                  <BudgetBar pct={r.pct} />
                </div>
                {r.basis === "forecast" ? (
                  <p className="mt-1 text-xs text-stone-500">
                    Forecast to finish at{" "}
                    <span className="font-medium tabular-nums text-stone-600 dark:text-stone-300">
                      {formatCents(r.forecastCents ?? 0)}
                    </span>
                    {r.forecastNote ? ` — ${r.forecastNote}` : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-stone-500">
                    Based on cost incurred so far. No forecast has been published for this item yet.
                  </p>
                )}
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-500 sm:grid-cols-5">
                  <span>Estimate {formatCents(r.estimateCents)}</span>
                  <span>Variations {r.variationsCents !== 0 ? `+${formatCents(r.variationsCents)}` : "—"}</span>
                  <span className="font-medium text-stone-600">Approved budget {formatCents(r.revisedCents)}</span>
                  <span className="font-medium text-amber-800 dark:text-amber-200">Spent {formatCents(r.currentCents)}</span>
                  <span>Used {fmtPct(r.pct)}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-stone-400">
            A code shows here when it is forecast to finish above its approved budget, or when cost incurred has
            already passed it. The approved budget already includes any approved variations for that item.
            Estimates are reforecast as the build progresses and are not a cap on final cost — a movement here is
            information, not an extra charge.
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
