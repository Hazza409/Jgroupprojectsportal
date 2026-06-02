import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents, sumCents, inclMarginGst, BUILDERS_MARGIN, GST } from "@/lib/money";
import Link from "next/link";
import { ModuleHeader } from "@/components/ModuleHeader";
import { UploadForm } from "./UploadForm";
import { AddLineForm } from "./AddLineForm";

export default async function EstimatePage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;

  const [lines, lastImport] = await Promise.all([
    db.estimateLineItem.findMany({
      where: { projectId },
      include: { costCode: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.estimateImport.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } }),
  ]);

  const total = sumCents(lines.map((l) => l.totalCents));

  return (
    <div>
      <ModuleHeader
        title="Original Estimate"
        description={
          user.role === "BUILDER"
            ? lastImport
              ? `Imported from ${lastImport.originalName} · ${lines.length} line items`
              : "Import from Excel or add line items manually."
            : `The project's original estimate · ${lines.length} line items`
        }
        action={
          user.role === "BUILDER" ? (
            <Link href={`/api/templates/estimate`} className="btn-ghost">Blank template</Link>
          ) : null
        }
      />

      {/* Only builders import / add; clients view the result. */}
      {user.role === "BUILDER" && (
        <div className="mb-6 space-y-3">
          <UploadForm projectId={projectId} />
          <AddLineForm projectId={projectId} />
        </div>
      )}

      {lines.length === 0 ? (
        <div className="card text-stone-500">No estimate line items yet.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Cost code</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3 text-right">Unit cost</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 font-mono text-xs">{l.costCode?.code ?? "—"}</td>
                  <td className="px-4 py-2">{l.description}</td>
                  <td className="px-4 py-2 text-right">{l.quantity}</td>
                  <td className="px-4 py-2">{l.unit ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{formatCents(l.unitCostCents)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCents(l.totalCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-stone-200 bg-stone-50">
              <tr className="text-stone-500">
                <td colSpan={5} className="px-4 py-2 text-right">Subtotal (ex margin &amp; GST)</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCents(total)}</td>
              </tr>
              <tr className="text-stone-500">
                <td colSpan={5} className="px-4 py-2 text-right">
                  + Builder&apos;s margin ({(BUILDERS_MARGIN * 100).toFixed(1)}%) &amp; GST ({(GST * 100).toFixed(0)}%)
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCents(inclMarginGst(total) - total)}
                </td>
              </tr>
              <tr className="border-t border-stone-200 font-semibold">
                <td colSpan={5} className="px-4 py-3 text-right">Total (incl margin &amp; GST)</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(inclMarginGst(total))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
