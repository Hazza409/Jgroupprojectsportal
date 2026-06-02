import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, sumCents } from "@/lib/money";
import { ModuleHeader } from "@/components/ModuleHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { createClaim } from "./actions";

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
            const total = sumCents(c.lines.map((l) => l.claimedAmountCents));
            return (
              <Link
                key={c.id}
                href={`/projects/${projectId}/progress-claims/${c.id}`}
                className="card flex items-center justify-between hover:shadow-md"
              >
                <div>
                  <p className="font-medium">Claim #{c.claimNumber} · {formatCents(total)}</p>
                  <p className="text-xs text-stone-400">
                    {c.lines.length} line item(s)
                    {c.reconSheetKey ? " · recon attached" : ""}
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
    </div>
  );
}
