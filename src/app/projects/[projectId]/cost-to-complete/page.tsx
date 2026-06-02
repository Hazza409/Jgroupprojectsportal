import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, sumCents } from "@/lib/money";
import { ModuleHeader } from "@/components/ModuleHeader";

// Cost to Complete = per cost code: estimate (budget) vs actuals (from Xero),
// % complete, and remaining. Actuals are populated one-directionally by the
// Xero sync service (src/lib/xero/sync.ts) — TODO until OAuth is wired.
export default async function CostToCompletePage({ params }: { params: { projectId: string } }) {
  await assertProjectAccess(params.projectId);
  const projectId = params.projectId;

  const costCodes = await db.costCode.findMany({
    where: { projectId },
    orderBy: { code: "asc" },
    include: {
      estimateLines: { select: { totalCents: true } },
      costActuals: { select: { amountCents: true } },
    },
  });

  const rows = costCodes.map((cc) => {
    const budget = sumCents(cc.estimateLines.map((l) => l.totalCents));
    const actual = sumCents(cc.costActuals.map((a) => a.amountCents));
    const pct = budget > 0 ? Math.min(100, Math.round((actual / budget) * 100)) : 0;
    return { id: cc.id, code: cc.code, name: cc.name, budget, actual, pct, remaining: budget - actual };
  });

  const totalBudget = sumCents(rows.map((r) => r.budget));
  const totalActual = sumCents(rows.map((r) => r.actual));
  const hasActuals = totalActual !== 0;

  return (
    <div>
      <ModuleHeader
        title="Cost to Complete"
        description="Budget vs actuals per cost code. Actuals sync one-directionally from Xero."
      />

      {!hasActuals && (
        <div className="card mb-4 border-amber-200 bg-amber-50 text-sm text-amber-800">
          No Xero actuals yet. Connect Xero and run the sync service to populate actual costs
          against matching cost codes. <span className="font-mono text-xs">(src/lib/xero/sync.ts — TODO)</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card text-stone-500">No cost codes. Import an estimate first.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-right">Budget</th>
                <th className="px-4 py-3 text-right">Actual (Xero)</th>
                <th className="px-4 py-3 text-right">% complete</th>
                <th className="px-4 py-3 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-4 py-2 text-right">{formatCents(r.budget)}</td>
                  <td className="px-4 py-2 text-right">{formatCents(r.actual)}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-1.5 w-16 overflow-hidden rounded bg-stone-100">
                        <span className="block h-full bg-brand" style={{ width: `${r.pct}%` }} />
                      </span>
                      {r.pct}%
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium">{formatCents(r.remaining)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-stone-200 bg-stone-50 font-semibold">
              <tr>
                <td colSpan={2} className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right">{formatCents(totalBudget)}</td>
                <td className="px-4 py-3 text-right">{formatCents(totalActual)}</td>
                <td />
                <td className="px-4 py-3 text-right">{formatCents(totalBudget - totalActual)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
