import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, sumCents } from "@/lib/money";
import { ModuleHeader } from "@/components/ModuleHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { createClaim, submitClaim, decideClaim } from "./actions";

export default async function ProgressClaimsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const claims = await db.progressClaim.findMany({
    where: { projectId },
    orderBy: { claimNumber: "desc" },
    include: { lines: { select: { claimedAmountCents: true } } },
  });

  return (
    <div>
      <ModuleHeader
        title="Progress Claims"
        description="Builder submits, client approves. Approved claims are flagged for a separate Xero push."
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
            const total = sumCents(c.lines.map((l) => l.claimedAmountCents));
            return (
              <div key={c.id} className="card flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    Claim #{c.claimNumber} · {formatCents(total)}
                  </p>
                  <p className="text-xs text-stone-400">
                    {c.lines.length} line item(s)
                    {c.xeroInvoiceId ? " · pushed to Xero" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={c.status} />
                  {isBuilder && c.status === "DRAFT" && (
                    <form action={submitClaim.bind(null, projectId, c.id)}>
                      <button className="btn-ghost" type="submit">Submit</button>
                    </form>
                  )}
                  {c.status === "SUBMITTED" && (
                    <>
                      <form action={decideClaim.bind(null, projectId, c.id, true)}>
                        <button className="btn-primary" type="submit">Approve</button>
                      </form>
                      <form action={decideClaim.bind(null, projectId, c.id, false)}>
                        <button className="btn-ghost" type="submit">Reject</button>
                      </form>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-stone-400">
        Reconciliation-sheet attachment and Xero invoice push are wired as interfaces
        (see <code>src/lib/xero/invoicePush.ts</code>) — money movement never auto-fires.
      </p>
    </div>
  );
}
