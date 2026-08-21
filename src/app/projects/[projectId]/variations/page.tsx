import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, inclMarginGst } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { ModuleHeader } from "@/components/ModuleHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { VariationsUploadForm } from "./VariationsUploadForm";

export default async function VariationsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  // DRAFT variations are the builder's workspace and must never reach a client
  // (Jake §1). Enforced in the query, not just hidden in the UI.
  const variations = await db.variation.findMany({
    where: isBuilder ? { projectId } : { projectId, status: { not: "DRAFT" } },
    orderBy: { variationNumber: "desc" },
    select: {
      id: true,
      variationNumber: true,
      title: true,
      status: true,
      totalCents: true,
      _count: { select: { lines: true } },
    },
  });

  return (
    <div>
      <ModuleHeader
        title="Variation Register"
        description={
          isBuilder
            ? "Price variations and submit them for client approval. Drafts stay internal until submitted."
            : "Changes to the scope of works. Open a variation to see the breakdown and approve it."
        }
        action={
          isBuilder ? (
            <Link href={`/api/templates/variations`} className="btn-ghost">Blank template</Link>
          ) : null
        }
      />

      <div className="mb-6 rounded-md border border-stone-200 bg-stone-100/50 px-4 py-2 text-sm text-stone-600">
        {/* TODO(Andrew): margin disclosure wording to be locked (Jake §4). */}
        Variation prices include builder&apos;s margin ({company.marginPercent.toFixed(1)}%) and GST ({company.gstPercent.toFixed(0)}%).
        {isBuilder && " Subcontractor quotes are the underlying supplier cost."}
      </div>

      {isBuilder && (
        <div className="mb-6 space-y-3">
          <VariationsUploadForm projectId={projectId} />
          <div>
            <Link href={`/projects/${projectId}/variations/new`} className="btn-ghost">
              + Add a variation manually
            </Link>
          </div>
        </div>
      )}

      {variations.length === 0 ? (
        <div className="card text-stone-500">No variations yet.</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full min-w-[46rem] table-fixed text-xs sm:text-sm">
            <colgroup>
              <col className="w-[42%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[15%]" />
              <col className="w-[16%]" />
              <col className="w-[9%]" />
            </colgroup>
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-3">Variation</th>
                <th className="px-3 py-3">Ref</th>
                <th className="px-3 py-3">Lines</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Amount</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 align-top">
              {variations.map((v) => (
                <tr key={v.id} className="hover:bg-stone-50">
                  <td className="px-3 py-3 font-medium break-words">{v.title}</td>
                  <td className="px-3 py-3 tabular-nums text-stone-500">#{v.variationNumber}</td>
                  <td className="px-3 py-3 tabular-nums text-stone-500">{v._count.lines}</td>
                  <td className="px-3 py-3"><StatusBadge status={v.status} /></td>
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                    {v.status === "DRAFT" && v.totalCents === 0 ? "Being priced" : formatCents(inclMarginGst(v.totalCents, company))}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link href={`/projects/${projectId}/variations/${v.id}`} className="text-brand hover:underline">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
