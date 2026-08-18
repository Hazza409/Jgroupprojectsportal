import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, inclMarginGst } from "@/lib/money";
import { getCompany, companyShortName } from "@/lib/company";
import { computeCostToComplete, overrunSummary, claimHeadlineCents } from "@/lib/claims";
import Link from "next/link";
import { ModuleHeader } from "@/components/ModuleHeader";
import { isConnected } from "@/lib/xero/tokens";
import { XeroControls } from "./XeroControls";
import { CurrentCostsImport } from "./CurrentCostsImport";
import { rematchClaimCosts } from "./actions";

// Cost to Complete — laid out like the J Group CTC workbook. EVERY figure on this
// page is shown INCLUSIVE of builder's margin then GST (rates from Company settings) — no mixing
// of ex/inc amounts. Underlying DB values are stored ex-margin/ex-GST; we gross
// up once here via inclMarginGst().
export default async function CostToCompletePage({
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

  const [xeroConnected, xeroConn, ctc, approvedVars] = await Promise.all([
    isConnected(projectId),
    db.xeroConnection.findUnique({ where: { projectId }, select: { lastSyncedAt: true } }),
    // Shared computation — identical numbers to the Excel export (see claims.ts).
    computeCostToComplete(projectId, company),
    // For the side panel only (title + amount per approved variation).
    db.variation.findMany({
      where: { projectId, status: "APPROVED" },
      orderBy: { variationNumber: "asc" },
      select: { id: true, title: true, totalCents: true },
    }),
  ]);

  // Claims that have been entered but haven't reached these figures yet. Costs
  // post to Current to Date on APPROVAL, so a builder who has just entered an
  // invoice sees this page unchanged and has no way to tell whether the link is
  // broken or the claim simply isn't approved. Builder-only — draft claims are
  // internal until issued.
  const pendingClaims = isBuilder
    ? await db.progressClaim.findMany({
        where: { projectId, status: { in: ["DRAFT", "SUBMITTED"] } },
        orderBy: { claimNumber: "asc" },
        select: {
          id: true, claimNumber: true, status: true, periodLabel: true,
          totalCents: true, lines: { select: { claimedAmountCents: true } },
        },
      })
    : [];
  const pending = pendingClaims
    .map((c) => ({ ...c, headline: claimHeadlineCents(c, company) }))
    .filter((c) => c.headline > 0);
  const pendingTotal = pending.reduce((a, c) => a + c.headline, 0);

  // WHY money is sitting in Unallocated. The row on its own is a dead end — it
  // shows a total and nothing about what caused it, and the two causes need
  // opposite fixes:
  //   · "not itemised by cost code" → the sheet had no Budget Overview rows, so
  //     there was nothing to split by. Fix the sheet, re-import.
  //   · a named line → the line parsed but its name matched no cost code. Fix
  //     the name (either end), then "Re-match claim costs".
  const unallocatedSources = isBuilder
    ? await db.costActual.findMany({
        where: { projectId, costCodeId: null, amountCents: { not: 0 } },
        orderBy: { amountCents: "desc" },
        select: { id: true, description: true, amountCents: true, xeroSourceId: true },
      })
    : [];
  const unmatchedNames = unallocatedSources.filter((a) => !a.xeroSourceId?.endsWith(":remainder"));
  const unitemised = unallocatedSources.filter((a) => a.xeroSourceId?.endsWith(":remainder"));

  // Aliases so the table markup below stays unchanged (all values incl margin+GST).
  const rows = ctc.rows.map((r) => ({
    id: r.id, code: r.code, name: r.name,
    estimate: r.estimateCents, variations: r.variationsCents, revised: r.revisedCents,
    current: r.currentCents, variance: r.varianceCents,
  }));
  const unallocated = ctc.unallocated.currentCents;
  const unallocatedEst = ctc.unallocated.estimateCents;
  const unallocatedVar = ctc.unallocated.variationsCents;
  const estimateTotal = ctc.totals.estimateCents;
  const approvedVarTotal = ctc.totals.variationsCents;
  const revisedEstimate = ctc.totals.revisedCents;
  const currentToDate = ctc.totals.currentCents;
  const costToComplete = ctc.totals.costToCompleteCents;
  const hasActuals = currentToDate !== 0;

  // Overruns — same basis as the Budget/Overruns tabs (shared helper).
  const overruns = overrunSummary(ctc);
  const overIds = new Set(overruns.rows.map((r) => r.id));

  const summary = [
    { label: "Current to Date", value: formatCents(currentToDate) },
    { label: "Revised Estimate", value: formatCents(revisedEstimate) },
    { label: "Cost to Complete", value: formatCents(costToComplete) },
  ];

  return (
    <div>
      <ModuleHeader
        title="Cost to Complete"
        description={
          isBuilder
            ? "Estimate vs current cost to date, per cost code. Current costs sync one-directionally from Xero."
            : "Your budget against costs incurred to date, by trade."
        }
        action={
          isBuilder ? (
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
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-start gap-2">
        {isBuilder && <CurrentCostsImport projectId={projectId} />}
        {isBuilder && (
          /* Re-links approved claims' lines to cost codes (fuzzy) + re-posts them. */
          <form action={rematchClaimCosts.bind(null, projectId)}>
            <button className="btn-ghost" type="submit">Re-match claim costs</button>
          </form>
        )}
        <a className="btn-ghost" href={`/api/projects/${projectId}/export`}>Export to Excel</a>
      </div>

      {/* Unambiguous: every figure on this page is grossed up. */}
      <div className="mb-4 rounded-md border border-stone-200 bg-stone-100/50 px-4 py-2 text-sm text-stone-600">
        All amounts include builder&apos;s margin ({company.marginPercent.toFixed(1)}%) and GST ({company.gstPercent.toFixed(0)}%).
      </div>

      {/* Three headline figures, as per the CTC workbook. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {summary.map((s) => (
          <div key={s.label} className="card">
            <p className="text-xs uppercase tracking-wide text-stone-400">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/*
        Entered but not yet in the figures above. Without this the page is
        silent about the single most common question: "I put the invoice in,
        why hasn't Current to Date moved?"
      */}
      {pending.length > 0 && (
        <div className="card mb-6 border-amber-500/40 bg-amber-500/10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {formatCents(pendingTotal)} claimed but not yet in Current to Date
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-200/80">
              Claim costs post here when the claim is approved.
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

      {/* Why is Unallocated non-zero? Name the cause and the fix. */}
      {isBuilder && unallocated !== 0 && (
        <div className="card mb-6 border-amber-500/40 bg-amber-500/10">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            {formatCents(unallocated)} isn&apos;t split by cost code
          </p>
          {unitemised.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-800/80 dark:text-amber-200/80">
                Not itemised on the sheet — {formatCents(inclMarginGst(unitemised.reduce((a, u) => a + u.amountCents, 0), company))}
              </p>
              <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-100/90">
                These claims had no <strong>Budget Overview</strong> rows, so there was nothing to split their
                costs by. The money is counted in the totals, but it can&apos;t appear against a trade until the
                sheet is re-imported with that section present.
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
          {unmatchedNames.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-800/80 dark:text-amber-200/80">
                No matching cost code — {formatCents(inclMarginGst(unmatchedNames.reduce((a, u) => a + u.amountCents, 0), company))}
              </p>
              <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-100/90">
                These lines came through, but their names don&apos;t match any cost code on this job. Rename at
                either end so they agree, then press <strong>Re-match claim costs</strong>.
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
                <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
                  + {unmatchedNames.length - 15} more
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {searchParams.xero === "connected" && (
        <div className="card mb-4 border-emerald-500/30 dark:border-emerald-400/30 bg-emerald-500/10 dark:bg-emerald-400/10 text-sm text-emerald-700 dark:text-emerald-200">
          Xero connected. Click <strong>Sync now</strong> to pull current costs.
        </div>
      )}
      {searchParams.xero === "error" && (
        <div className="card mb-4 border-red-500/30 dark:border-red-400/30 bg-red-500/10 dark:bg-red-400/10 text-sm text-red-700 dark:text-red-200">
          Xero connection failed. Check your app credentials and try again.
        </div>
      )}
      {!hasActuals && (
        <div className="card mb-4 border-amber-500/30 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-sm text-amber-700 dark:text-amber-200">
          No current costs yet.{" "}
          {isBuilder
            ? xeroConnected
              ? "Click Sync now to pull current costs against matching cost codes."
              : "Connect Xero (top right) or import current costs to populate this view."
            : `Costs appear once ${companyShortName(company)} connects Xero and syncs.`}
        </div>
      )}

      {/* Overruns are the exception worth calling out — a negative variance
          number alone is too easy to miss. Detail lives on the Overruns tab. */}
      {overruns.count > 0 && (
        <Link
          href={`/projects/${projectId}/overruns`}
          className="card mb-4 flex flex-wrap items-center justify-between gap-2 border-red-500/30 hover:shadow-md"
        >
          <span className="text-sm">
            <span className="font-medium text-red-700 dark:text-red-300">
              {overruns.count} cost code{overruns.count === 1 ? " is" : "s are"} over budget by {formatCents(overruns.totalOverCents)}
            </span>
            {overruns.absorbed && (
              <span className="text-stone-500"> · currently absorbed by underspend elsewhere</span>
            )}
          </span>
          <span className="text-sm text-stone-500">See the Overruns tab →</span>
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Estimate vs Current vs Variance */}
        {rows.length === 0 ? (
          <div className="card text-stone-500">No cost codes. Import an estimate first.</div>
        ) : (
          <div className="card p-0">
            {/* table-fixed + colgroup keeps all 7 columns inside the card width
                so the whole table is visible without horizontal scrolling. */}
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col className="w-[9%]" />
                <col className="w-[16%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-2 py-2.5">Code</th>
                  <th className="px-2 py-2.5">Cost Item</th>
                  <th className="px-2 py-2.5 text-right">Estimate</th>
                  <th className="px-2 py-2.5 text-right">Variations</th>
                  <th className="px-2 py-2.5 text-right">Revised</th>
                  <th className="px-2 py-2.5 text-right">Current</th>
                  <th className="px-2 py-2.5 text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 align-top">
                {rows.map((r) => (
                  <tr key={r.id} className={overIds.has(r.id) ? "bg-red-500/5" : undefined}>
                    <td className="px-2 py-2 font-mono text-xs text-stone-400 whitespace-nowrap">{r.code}</td>
                    <td className="px-2 py-2 break-words">{r.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{formatCents(r.estimate)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-stone-500">
                      {r.variations !== 0 ? `+${formatCents(r.variations)}` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{formatCents(r.revised)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{formatCents(r.current)}</td>
                    <td
                      className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${
                        r.variance < 0 ? "font-medium text-red-700 dark:text-red-300" : "text-stone-500"
                      }`}
                    >
                      {formatCents(r.variance)}
                      {r.variance < 0 && <span className="ml-1 text-[10px] uppercase">over</span>}
                    </td>
                  </tr>
                ))}
                {(unallocated !== 0 || unallocatedEst !== 0 || unallocatedVar !== 0) && (
                  <tr>
                    <td className="px-2 py-2 font-mono text-xs text-stone-400">—</td>
                    <td className="px-2 py-2 text-stone-500 break-words">Unallocated (no matching cost code)</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-stone-500">
                      {unallocatedEst !== 0 ? formatCents(unallocatedEst) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-stone-500">
                      {unallocatedVar !== 0 ? `+${formatCents(unallocatedVar)}` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-stone-500">{formatCents(unallocatedEst + unallocatedVar)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{unallocated !== 0 ? formatCents(unallocated) : "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-stone-500">{formatCents(unallocatedEst + unallocatedVar - unallocated)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t border-stone-200 bg-stone-50 font-semibold">
                <tr>
                  <td colSpan={2} className="px-2 py-2.5">Total</td>
                  <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{formatCents(estimateTotal)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{approvedVarTotal !== 0 ? `+${formatCents(approvedVarTotal)}` : "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{formatCents(revisedEstimate)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{formatCents(currentToDate)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{formatCents(revisedEstimate - currentToDate)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Approved variations panel */}
        <div className="card h-fit">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Approved Variations
          </h3>
          {approvedVars.length === 0 ? (
            <p className="text-sm text-stone-500">None approved yet.</p>
          ) : (
            <>
              <ul className="space-y-2">
                {approvedVars.map((v) => (
                  <li key={v.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0 text-stone-600">{v.title}</span>
                    <span className="shrink-0 tabular-nums">{formatCents(inclMarginGst(v.totalCents, company))}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-stone-200 pt-3 text-sm font-semibold">
                <span>Total approved</span>
                <span className="tabular-nums">{formatCents(approvedVarTotal)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
