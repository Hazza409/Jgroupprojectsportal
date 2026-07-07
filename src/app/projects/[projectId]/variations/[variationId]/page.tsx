import Link from "next/link";
import { notFound } from "next/navigation";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { formatCents, inclMarginGst } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { StatusBadge } from "@/components/StatusBadge";
import { submitVariation, decideVariation, attachQuote, setVariationLineCostCodes } from "../actions";

export default async function VariationDetailPage({
  params,
}: {
  params: { projectId: string; variationId: string };
}) {
  const user = await assertProjectAccess(params.projectId);
  const { projectId, variationId } = params;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  const v = await db.variation.findFirst({
    where: { id: variationId, projectId },
    include: {
      lines: { include: { costCode: { select: { code: true, name: true } } } },
      quotes: true,
    },
  });
  if (!v) notFound();

  // Cost codes for the per-line allocation pickers (which CTC code each line adds to).
  const costCodes = await db.costCode.findMany({
    where: { projectId },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  // Resolve download URLs for quote files (scope already enforced above).
  const store = await storage();
  const quoteUrls = new Map<string, string>();
  for (const q of v.quotes) quoteUrls.set(q.id, await store.url(q.fileKey));

  const inclTotal = inclMarginGst(v.totalCents, company);

  return (
    <div>
      <Link href={`/projects/${projectId}/variations`} className="text-sm text-stone-500 hover:text-ink">
        ← Variation Register
      </Link>

      <div className="mt-2 mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">VO #{v.variationNumber} · {v.title}</h2>
          {v.description && <p className="mt-0.5 text-sm text-stone-500">{v.description}</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-semibold tabular-nums">
            {v.status === "DRAFT" && v.totalCents === 0 ? "Being priced" : formatCents(inclTotal)}
          </span>
          <StatusBadge status={v.status} />
        </div>
      </div>

      {/* Line-item breakdown — each line allocates to a cost code, feeding the
          Cost to Complete "Variations" column. Builders edit inline; the whole
          table is one form so all lines save together. */}
      <form action={setVariationLineCostCodes.bind(null, projectId, variationId)}>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Line item</th>
                <th className="px-4 py-3">Cost code</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3 text-right">Amount (incl margin &amp; GST)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {v.lines.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-4 text-stone-500">No line items.</td></tr>
              ) : (
                v.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2">{l.description || "Line item"}</td>
                    <td className="px-4 py-2">
                      {isBuilder ? (
                        <select
                          name={`code_${l.id}`}
                          defaultValue={l.costCodeId ?? ""}
                          className="rounded-md border border-stone-300 bg-transparent px-2 py-1 text-sm"
                        >
                          <option value="">— Unallocated —</option>
                          {costCodes.map((c) => (
                            <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-stone-500">{l.costCode ? `${l.costCode.code} · ${l.costCode.name}` : "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.quantity}</td>
                    <td className="px-4 py-2">{l.unit ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(inclMarginGst(l.totalCents, company))}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="border-t border-stone-200 bg-stone-50">
              <tr className="text-stone-500">
                <td colSpan={4} className="px-4 py-2 text-right">Subtotal (ex margin &amp; GST)</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCents(v.totalCents)}</td>
              </tr>
              <tr className="text-stone-500">
                <td colSpan={4} className="px-4 py-2 text-right">
                  + Builder&apos;s margin ({company.marginPercent.toFixed(1)}%) &amp; GST ({company.gstPercent.toFixed(0)}%)
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCents(inclTotal - v.totalCents)}</td>
              </tr>
              <tr className="border-t border-stone-200 font-semibold">
                <td colSpan={4} className="px-4 py-3 text-right">Total (incl margin &amp; GST)</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(inclTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {isBuilder && v.lines.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <button type="submit" className="btn-ghost">Save cost codes</button>
            <span className="text-xs text-stone-400">Allocates each line to a cost code for Cost to Complete.</span>
          </div>
        )}
      </form>

      {/* Subcontractor quotes (builder backup — underlying supplier cost) */}
      {v.quotes.length > 0 && (
        <div className="card mt-4 text-sm">
          <p className="mb-1 text-xs uppercase tracking-wide text-stone-400">Subcontractor quotes</p>
          <ul className="space-y-1">
            {v.quotes.map((q) => (
              <li key={q.id} className="flex justify-between">
                <a className="text-brand underline" href={quoteUrls.get(q.id)} target="_blank" rel="noreferrer">
                  {q.vendorName} — {q.originalName}
                </a>
                <span className="tabular-nums">{formatCents(q.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {isBuilder && v.status === "DRAFT" && (
          <form action={submitVariation.bind(null, projectId, v.id)}>
            <button className="btn-primary" type="submit">Submit for approval</button>
          </form>
        )}
        {v.status === "SUBMITTED" && (
          <>
            <form action={decideVariation.bind(null, projectId, v.id, true)}>
              <button className="btn-primary" type="submit">Approve</button>
            </form>
            <form action={decideVariation.bind(null, projectId, v.id, false)}>
              <button className="btn-ghost" type="submit">Reject</button>
            </form>
          </>
        )}
      </div>

      {isBuilder && (
        <form
          action={attachQuote.bind(null, projectId, v.id)}
          className="card mt-4 flex flex-wrap items-end gap-2"
        >
          <p className="w-full text-xs font-semibold uppercase tracking-wide text-stone-500">Attach a subcontractor quote</p>
          <input name="vendorName" className="input !w-40" placeholder="Vendor" />
          <input name="amount" type="number" step="0.01" className="input !w-32" placeholder="Amount $" />
          <input name="file" type="file" required className="text-xs" />
          <button className="btn-ghost" type="submit">Attach quote</button>
        </form>
      )}
    </div>
  );
}
