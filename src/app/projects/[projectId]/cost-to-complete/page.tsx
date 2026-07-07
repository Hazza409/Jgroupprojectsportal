import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, sumCents, inclMarginGst } from "@/lib/money";
import { getCompany, companyShortName } from "@/lib/company";
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

  const [xeroConnected, xeroConn, costCodes, approvedVars, unallocatedActuals, unallocatedEstLines] = await Promise.all([
    isConnected(projectId),
    db.xeroConnection.findUnique({ where: { projectId }, select: { lastSyncedAt: true } }),
    db.costCode.findMany({
      where: { projectId },
      orderBy: { code: "asc" },
      include: {
        estimateLines: { select: { totalCents: true } },
        costActuals: { select: { amountCents: true } },
      },
    }),
    db.variation.findMany({
      where: { projectId, status: "APPROVED" },
      orderBy: { variationNumber: "asc" },
      select: { id: true, variationNumber: true, title: true, totalCents: true, costCodeId: true },
    }),
    // Costs with no matching cost code (e.g. claim lines for variation work or
    // renamed items) — shown as an "Unallocated" row so money never disappears.
    db.costActual.findMany({ where: { projectId, costCodeId: null }, select: { amountCents: true } }),
    // Estimate lines with no cost code — included in the total (and their own
    // row) so the CTC estimate reconciles with the Overview and drawdown budget.
    db.estimateLineItem.findMany({ where: { projectId, costCodeId: null }, select: { totalCents: true } }),
  ]);

  // Approved variations grouped by the cost code they add to (ex-margin base).
  const varBaseByCode = new Map<string, number>();
  let unallocatedVarBase = 0;
  for (const v of approvedVars) {
    if (v.costCodeId) varBaseByCode.set(v.costCodeId, (varBaseByCode.get(v.costCodeId) ?? 0) + v.totalCents);
    else unallocatedVarBase += v.totalCents;
  }

  // Per-code rows grossed up for display. Revised = estimate + approved
  // variations for that code; variance measures against the revised budget.
  const rows = costCodes.map((cc) => {
    const estimate = inclMarginGst(sumCents(cc.estimateLines.map((l) => l.totalCents)), company);
    const variations = inclMarginGst(varBaseByCode.get(cc.id) ?? 0, company);
    const current = inclMarginGst(sumCents(cc.costActuals.map((a) => a.amountCents)), company);
    const revised = estimate + variations;
    return { id: cc.id, code: cc.code, name: cc.name, estimate, variations, revised, current, variance: revised - current };
  });

  // Unallocated costs / estimate / variations (no matching cost code) — kept
  // visible so the page totals reconcile with the Overview, drawdown, register.
  const unallocatedBase = sumCents(unallocatedActuals.map((a) => a.amountCents));
  const unallocated = inclMarginGst(unallocatedBase, company);
  const unallocatedEstBase = sumCents(unallocatedEstLines.map((l) => l.totalCents));
  const unallocatedEst = inclMarginGst(unallocatedEstBase, company);
  const unallocatedVar = inclMarginGst(unallocatedVarBase, company);

  // Totals are grossed from the AGGREGATE base (not summed per-row) so they match
  // the Overview to the cent — single, unambiguous rounding.
  const estimateTotal = inclMarginGst(
    sumCents(costCodes.flatMap((cc) => cc.estimateLines.map((l) => l.totalCents))) + unallocatedEstBase,
    company,
  );
  const currentToDate = inclMarginGst(
    sumCents(costCodes.flatMap((cc) => cc.costActuals.map((a) => a.amountCents))) + unallocatedBase,
    company,
  );
  const approvedVarTotal = inclMarginGst(sumCents(approvedVars.map((v) => v.totalCents)), company);

  const revisedEstimate = estimateTotal + approvedVarTotal;
  const costToComplete = revisedEstimate - currentToDate;
  const hasActuals = currentToDate !== 0;

  const summary = [
    { label: "Current to Date", value: formatCents(currentToDate) },
    { label: "Revised Estimate", value: formatCents(revisedEstimate) },
    { label: "Cost to Complete", value: formatCents(costToComplete) },
  ];

  return (
    <div>
      <ModuleHeader
        title="Cost to Complete"
        description="Estimate vs current cost to date, per cost code. Current costs sync one-directionally from Xero."
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

      {isBuilder && (
        <div className="mb-4 flex flex-wrap items-start gap-2">
          <CurrentCostsImport projectId={projectId} />
          {/* Re-links approved claims' lines to cost codes (fuzzy) + re-posts them. */}
          <form action={rematchClaimCosts.bind(null, projectId)}>
            <button className="btn-ghost" type="submit">Re-match claim costs</button>
          </form>
        </div>
      )}

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

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Estimate vs Current vs Variance */}
        {rows.length === 0 ? (
          <div className="card text-stone-500">No cost codes. Import an estimate first.</div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Cost Item</th>
                  <th className="px-4 py-3 text-right">Estimate</th>
                  <th className="px-4 py-3 text-right">Variations</th>
                  <th className="px-4 py-3 text-right">Revised</th>
                  <th className="px-4 py-3 text-right">Current to Date</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 font-mono text-xs text-stone-400">{r.code}</td>
                    <td className="px-4 py-2">{r.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(r.estimate)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-500">
                      {r.variations !== 0 ? `+${formatCents(r.variations)}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(r.revised)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(r.current)}</td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${
                        r.variance < 0 ? "text-red-700 dark:text-red-300" : "text-stone-500"
                      }`}
                    >
                      {formatCents(r.variance)}
                    </td>
                  </tr>
                ))}
                {(unallocated !== 0 || unallocatedEst !== 0 || unallocatedVar !== 0) && (
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs text-stone-400">—</td>
                    <td className="px-4 py-2 text-stone-500">Unallocated (no matching cost code)</td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-500">
                      {unallocatedEst !== 0 ? formatCents(unallocatedEst) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-500">
                      {unallocatedVar !== 0 ? `+${formatCents(unallocatedVar)}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-500">{formatCents(unallocatedEst + unallocatedVar)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{unallocated !== 0 ? formatCents(unallocated) : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-500">{formatCents(unallocatedEst + unallocatedVar - unallocated)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t border-stone-200 bg-stone-50 font-semibold">
                <tr>
                  <td colSpan={2} className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCents(estimateTotal)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{approvedVarTotal !== 0 ? `+${formatCents(approvedVarTotal)}` : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCents(revisedEstimate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCents(currentToDate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCents(revisedEstimate - currentToDate)}</td>
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
