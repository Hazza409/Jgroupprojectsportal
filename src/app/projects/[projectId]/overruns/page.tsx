import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { formatCents, inclMarginGst, centsToNumber, moneyStructure } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { computeCostToComplete, overrunSummary } from "@/lib/claims";
import { correctCostName } from "@/lib/houseStyle";
import { forecastGate } from "@/lib/forecast";
import { db } from "@/lib/db";
import { ForecastWorkbench, type WorkbenchRow } from "@/components/ForecastWorkbench";
import { fmtDate } from "@/lib/dates";
import { logView } from "@/lib/audit";
import { ModuleHeader } from "@/components/ModuleHeader";
import { BudgetBar, pctUsed, fmtPct } from "@/components/BudgetBar";

/**
 * Forecast Adjustments. (Route stays /overruns: Jake §4 changed the labels,
 * not the data or any existing link.)
 *
 * Two audiences, two shapes:
 *   BUILDER — a single workbench: every cost code, its budget/spent/forecast,
 *   inline staging, and sign-off on the same surface. Data loads in parallel;
 *   the workbench shows a working state during saves, so nothing "freezes".
 *   CLIENT — the exception report: only movements, with the reason for each.
 *
 * Language is "above estimate", never "over budget", and the colour is amber,
 * never red: on cost plus the estimate was never a committed ceiling, so
 * "over budget" misdescribes the figure and reads as an admitted breach.
 */
export default async function OverrunsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  // Everything in parallel — this page previously awaited seven fetches in a
  // row, which on a remote database was seconds of blank wait per render.
  const [ctc, gate, costCodes, pendingProject] = await Promise.all([
    computeCostToComplete(projectId, company),
    isBuilder ? forecastGate(projectId, company) : Promise.resolve(null),
    isBuilder
      ? db.costCode.findMany({
          where: { projectId },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true, pendingForecastCents: true, pendingForecastNote: true },
        })
      : Promise.resolve([]),
    isBuilder
      ? db.project.findUnique({
          where: { id: projectId },
          select: { pendingForecastFinalCostCents: true, pendingForecastCompletionDate: true },
        })
      : Promise.resolve(null),
    logView(projectId, user, `/projects/${projectId}/overruns`, "Forecast Adjustments"),
  ]);

  // Shared with the Budget, Cost to Complete and Overview pages so all four
  // report identical movements on an identical basis.
  const summary = overrunSummary(ctc);
  // A movement listed on the FORECAST basis measures spend against the
  // forecast — the line's explained expected final cost — not the superseded
  // budget. Otherwise the card says "finishes at $114k" and "179% used" in
  // the same breath.
  const over = summary.rows.map((r) => ({
    ...r,
    pct: pctUsed(r.currentCents, r.basis === "forecast" && r.forecastCents !== null ? r.forecastCents : r.revisedCents),
  }));
  const totalOverCents = summary.totalOverCents;
  const netCents = summary.netCents;
  const worst = over[0];

  // ── Builder workbench rows: one basis (inc margin + GST) throughout ──
  const rows: WorkbenchRow[] = costCodes.map((cc) => {
    const r = ctc.rows.find((x) => x.id === cc.id);
    return {
      id: cc.id,
      code: cc.code,
      name: correctCostName(cc.name),
      budgetCents: r?.revisedCents ?? 0,
      spentCents: r?.currentCents ?? 0,
      publishedCents: r?.forecastCents ?? null,
      publishedNote: r?.forecastNote ?? null,
      stagedDollars:
        cc.pendingForecastCents === null ? "" : (inclMarginGst(cc.pendingForecastCents, company) / 100).toFixed(2),
      stagedNote: cc.pendingForecastNote ?? "",
      bases: {
        budget: (r?.bases.estimateCents ?? 0) + (r?.bases.variationsCents ?? 0),
        spent: r?.bases.currentCents ?? 0,
        forecast: r?.bases.forecastCents ?? null,
      },
    };
  });
  const alsoStaged: string[] = [];
  if (pendingProject?.pendingForecastFinalCostCents != null) {
    alsoStaged.push(`final cost ${formatCents(centsToNumber(pendingProject.pendingForecastFinalCostCents))}`);
  }
  if (pendingProject?.pendingForecastCompletionDate != null) {
    alsoStaged.push(`completion ${fmtDate(pendingProject.pendingForecastCompletionDate)}`);
  }
  const canSign = !!gate && (gate.unconfigured || gate.required.includes(user.email.toLowerCase()));

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Forecast Adjustments"
        description={
          isBuilder
            ? "Forecast what each cost code will finish at, and publish movements to the client with a reason — before spend gets there."
            : "Where costs are running — or are forecast to finish — above the original estimate for that item. Estimates are reforecast as the build progresses — these are not extra charges beyond what's been approved."
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

      {/* ── Headline position: same three figures for both audiences ── */}
      {over.length === 0 ? (
        <div className="card border-emerald-500/30">
          <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">
            ✓ Every cost code is tracking at or below its estimate
          </p>
          <p className="mt-1 text-sm text-stone-500">
            Nothing is currently forecast or spending above its approved budget.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="card border-amber-500/40">
            <p className="text-xs uppercase tracking-wide text-stone-400">Total above estimate</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-amber-800 dark:text-amber-200">
              {formatCents(totalOverCents)}
            </p>
            <p className="mt-1 text-xs text-stone-400">
              across {over.length} cost code{over.length === 1 ? "" : "s"}
              {summary.forecastCount > 0 && ` · ${summary.forecastCount} by forecast`}
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
      )}

      {/* ── BUILDER: the workbench is the page ── */}
      {isBuilder && rows.length > 0 && (
        <ForecastWorkbench
          projectId={projectId}
          rows={rows}
          canSign={canSign}
          gateWarning={gate?.warning ?? null}
          outstanding={gate?.outstanding ?? []}
          alsoStaged={alsoStaged}
          rates={{ marginPercent: company.marginPercent, gstPercent: company.gstPercent }}
        />
      )}
      {isBuilder && rows.length === 0 && (
        <div className="card text-stone-500">No cost codes yet. Import an estimate first.</div>
      )}

      {/* ── CLIENT: the exception report, one card per movement ── */}
      {!isBuilder && over.length > 0 && (
        <>
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
                  <>
                    <p className="mt-1 text-xs text-stone-500">
                      Forecast to finish at{" "}
                      <span className="font-medium tabular-nums text-stone-600 dark:text-stone-300">
                        {formatCents(r.forecastCents ?? 0)}
                      </span>
                      {r.forecastNote ? ` — ${r.forecastNote}` : ""}
                    </p>
                    {r.bases.forecastCents !== null && (() => {
                      const m = moneyStructure(r.bases.forecastCents, company);
                      return (
                        <p className="mt-0.5 text-xs tabular-nums text-stone-400">
                          Made up of: base cost {formatCents(m.baseCents)} + builder&apos;s margin ({company.marginPercent.toFixed(1)}%) {formatCents(m.marginCents)} + GST ({company.gstPercent.toFixed(0)}%) {formatCents(m.gstCents)}
                        </p>
                      );
                    })()}
                  </>
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
                  <span>Used {fmtPct(r.pct)}{r.basis === "forecast" ? " of forecast" : ""}</span>
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

      {/* Unallocated costs can mask a movement, so flag them here too. */}
      {ctc.unallocated.currentCents !== 0 && (
        <div className="card border-amber-500/30">
          <p className="text-xs uppercase tracking-wide text-stone-400">Unallocated costs</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCents(ctc.unallocated.currentCents)}</p>
          <p className="mt-1 text-xs text-stone-500">
            These sit against no cost code, so they aren&apos;t counted in any movement above.
            {isBuilder && " Allocate them via “Re-match claim costs” on Cost to Complete for a true picture."}
          </p>
        </div>
      )}
    </div>
  );
}
