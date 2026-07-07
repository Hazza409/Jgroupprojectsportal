import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, sumCents } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { projectDrawdown } from "@/lib/claims";
import { ModuleHeader } from "@/components/ModuleHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { createClaim } from "./actions";

export default async function ProgressClaimsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  const claims = await db.progressClaim.findMany({
    where: { projectId },
    orderBy: { claimNumber: "desc" },
    include: { lines: { select: { claimedAmountCents: true } }, _count: { select: { reconLines: true } } },
  });
  const drawdown = await projectDrawdown(projectId, company);

  return (
    <div>
      <ModuleHeader
        title="Progress Claims"
        description="Builder builds a claim from cost codes + reconciliation sheet, submits; client approves."
        action={
          isBuilder ? (
            <form action={createClaim.bind(null, projectId)}>
              <button className="btn-primary" type="submit">New claim</button>
            </form>
          ) : null
        }
      />

      {claims.length === 0 ? (
        <div className="card text-stone-500">No progress claims yet.</div>
      ) : (
        <div className="space-y-3">
          {claims.map((c) => {
            const total = c.totalCents > 0 ? c.totalCents : sumCents(c.lines.map((l) => l.claimedAmountCents));
            return (
              <Link
                key={c.id}
                href={`/projects/${projectId}/progress-claims/${c.id}`}
                className="card flex items-center justify-between hover:shadow-md"
              >
                <div>
                  <p className="font-medium">
                    Claim #{c.claimNumber}{c.periodLabel ? ` · ${c.periodLabel}` : ""} · {formatCents(total)}
                  </p>
                  <p className="text-xs text-stone-400">
                    {c._count.reconLines > 0 ? `from reconciliation sheet · ${c._count.reconLines} invoices` : `${c.lines.length} line item(s)`}
                    {c.xeroInvoiceId ? " · pushed to Xero" : ""}
                  </p>
                </div>
                <StatusBadge status={c.status} />
              </Link>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-stone-400">
        Open a claim to add line items, attach the reconciliation sheet, and submit for approval.
      </p>

      {/* Invoice-on-invoice contract drawdown */}
      {drawdown.rows.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Contract drawdown</h3>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <div className="card">
              <p className="text-xs uppercase tracking-wide text-stone-400">Budget (estimate + approved variations)</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">{formatCents(drawdown.budgetCents)}</p>
            </div>
            <div className="card">
              <p className="text-xs uppercase tracking-wide text-stone-400">Drawn to date (approved)</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {formatCents(drawdown.drawnCents)} <span className="text-sm font-normal text-stone-400">· {drawdown.pct.toFixed(1)}%</span>
              </p>
            </div>
            <div className="card">
              <p className="text-xs uppercase tracking-wide text-stone-400">Remaining to draw</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">{formatCents(drawdown.remainingCents)}</p>
            </div>
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3">Claim</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Drawn to date</th>
                  <th className="px-4 py-3 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {drawdown.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2">
                      <Link href={`/projects/${projectId}/progress-claims/${r.id}`} className="text-brand hover:underline">
                        #{r.claimNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-stone-500">{r.periodLabel ?? "—"}</td>
                    <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(r.amountCents)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.drawnToDateCents !== null ? formatCents(r.drawnToDateCents) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-500">
                      {r.remainingCents !== null ? formatCents(r.remainingCents) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-stone-400">
            Amounts include GST. Only approved claims draw down the budget; pending claims show — until approved.
          </p>
        </div>
      )}
    </div>
  );
}
