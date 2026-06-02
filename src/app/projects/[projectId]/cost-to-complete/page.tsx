import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, sumCents } from "@/lib/money";
import { ModuleHeader } from "@/components/ModuleHeader";
import { isConnected } from "@/lib/xero/tokens";
import { XeroControls } from "./XeroControls";
import { CurrentCostsImport } from "./CurrentCostsImport";

// Australian residential build assumptions (mirrors the J Group CTC workbook).
const BUILDERS_MARGIN = 0.125; // 12.5%
const GST = 0.1; // 10%

// Cost to Complete — laid out like the J Group CTC workbook:
//   Current to Date · Revised Estimate · Cost to Complete (incl BM & GST),
//   then Estimate vs Current vs Variance per cost code, plus Approved Variations.
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

  const [xeroConnected, xeroConn, costCodes, approvedVars] = await Promise.all([
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
      select: { id: true, variationNumber: true, title: true, totalCents: true },
    }),
  ]);

  const rows = costCodes.map((cc) => {
    const estimate = sumCents(cc.estimateLines.map((l) => l.totalCents));
    const current = sumCents(cc.costActuals.map((a) => a.amountCents));
    return { id: cc.id, code: cc.code, name: cc.name, estimate, current, variance: estimate - current };
  });

  const estimateTotal = sumCents(rows.map((r) => r.estimate));
  const currentToDate = sumCents(rows.map((r) => r.current));
  const approvedVarTotal = sumCents(approvedVars.map((v) => v.totalCents));

  // Revised estimate (incl builder's margin + GST), then cost remaining to complete.
  const revisedBase = estimateTotal + approvedVarTotal;
  const revisedInclBmGst = Math.round(revisedBase * (1 + BUILDERS_MARGIN) * (1 + GST));
  const costToComplete = revisedInclBmGst - currentToDate;
  const hasActuals = currentToDate !== 0;

  const summary = [
    { label: "Current to Date", value: formatCents(currentToDate) },
    { label: "Revised Estimate (incl BM & GST)", value: formatCents(revisedInclBmGst) },
    { label: "Cost to Complete (incl BM & GST)", value: formatCents(costToComplete) },
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
        <div className="mb-4">
          <CurrentCostsImport projectId={projectId} />
        </div>
      )}

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
        <div className="card mb-4 border-emerald-400/30 bg-emerald-400/10 text-sm text-emerald-200">
          Xero connected. Click <strong>Sync now</strong> to pull current costs.
        </div>
      )}
      {searchParams.xero === "error" && (
        <div className="card mb-4 border-red-400/30 bg-red-400/10 text-sm text-red-200">
          Xero connection failed. Check your app credentials and try again.
        </div>
      )}
      {!hasActuals && (
        <div className="card mb-4 border-amber-400/30 bg-amber-400/10 text-sm text-amber-200">
          No current costs yet.{" "}
          {isBuilder
            ? xeroConnected
              ? "Click Sync now to pull current costs against matching cost codes."
              : "Connect Xero (top right) or import current costs to populate this view."
            : "Costs appear once J Group connects Xero and syncs."}
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
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(r.current)}</td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${
                        r.variance < 0 ? "text-red-300" : "text-stone-500"
                      }`}
                    >
                      {formatCents(r.variance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-stone-200 bg-stone-50 font-semibold">
                <tr>
                  <td colSpan={2} className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCents(estimateTotal)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCents(currentToDate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCents(estimateTotal - currentToDate)}</td>
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
                    <span className="min-w-0 text-stone-300">{v.title}</span>
                    <span className="shrink-0 tabular-nums">{formatCents(v.totalCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-stone-200 pt-3 text-sm font-semibold">
                <span>Total approved (ex-GST)</span>
                <span className="tabular-nums">{formatCents(approvedVarTotal)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
