import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, inclMarginGst, BUILDERS_MARGIN, GST } from "@/lib/money";
import { ModuleHeader } from "@/components/ModuleHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { VariationsUploadForm } from "./VariationsUploadForm";

export default async function VariationsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const variations = await db.variation.findMany({
    where: { projectId },
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
        description="Click a variation to see its line-item breakdown and approve it."
        action={
          isBuilder ? (
            <Link href={`/api/templates/variations`} className="btn-ghost">Blank template</Link>
          ) : null
        }
      />

      <div className="mb-6 rounded-md border border-stone-200 bg-stone-100/50 px-4 py-2 text-sm text-stone-600">
        Variation prices include builder&apos;s margin ({(BUILDERS_MARGIN * 100).toFixed(1)}%) and GST ({(GST * 100).toFixed(0)}%).
        Subcontractor quotes are the underlying supplier cost.
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
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">VO #</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Lines</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Amount (incl margin &amp; GST)</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {variations.map((v) => (
                <tr key={v.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 tabular-nums">{v.variationNumber}</td>
                  <td className="px-4 py-3 font-medium">{v.title}</td>
                  <td className="px-4 py-3 tabular-nums text-stone-500">{v._count.lines}</td>
                  <td className="px-4 py-3"><StatusBadge status={v.status} /></td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {v.status === "DRAFT" && v.totalCents === 0 ? "Being priced" : formatCents(inclMarginGst(v.totalCents))}
                  </td>
                  <td className="px-4 py-3 text-right">
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
