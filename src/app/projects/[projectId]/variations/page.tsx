import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { formatCents, inclMarginGst, BUILDERS_MARGIN, GST } from "@/lib/money";
import { ModuleHeader } from "@/components/ModuleHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  createVariation,
  submitVariation,
  decideVariation,
  attachQuote,
} from "./actions";

export default async function VariationsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const variations = await db.variation.findMany({
    where: { projectId },
    orderBy: { variationNumber: "desc" },
    include: { lines: true, quotes: true },
  });

  // Resolve download URLs for all quote files up front (scope already enforced).
  const store = await storage();
  const quoteUrls = new Map<string, string>();
  for (const v of variations) {
    for (const q of v.quotes) quoteUrls.set(q.id, await store.url(q.fileKey));
  }

  return (
    <div>
      <ModuleHeader
        title="Variation Register"
        description="Each variation carries line items and a total for client approval."
      />

      <div className="mb-6 rounded-md border border-stone-200 bg-stone-100/50 px-4 py-2 text-sm text-stone-600">
        Variation prices include builder&apos;s margin ({(BUILDERS_MARGIN * 100).toFixed(1)}%) and GST ({(GST * 100).toFixed(0)}%).
        Subcontractor quotes are the underlying supplier cost.
      </div>

      {isBuilder && (
        <form action={createVariation.bind(null, projectId)} className="card mb-6 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Title</label>
            <input name="title" className="input" required placeholder="e.g. Upgrade to stone benchtops" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description (optional)</label>
            <input name="description" className="input" />
          </div>
          <div>
            <label className="label">Line description</label>
            <input name="lineDescription" className="input" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label">Qty</label>
              <input name="quantity" type="number" step="any" defaultValue={1} className="input" />
            </div>
            <div>
              <label className="label">Unit</label>
              <input name="unit" className="input" placeholder="ea" />
            </div>
            <div>
              <label className="label">Unit cost $</label>
              <input name="unitCost" type="number" step="0.01" className="input" placeholder="0.00" />
            </div>
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">Add variation</button>
          </div>
        </form>
      )}

      {variations.length === 0 ? (
        <div className="card text-stone-500">No variations yet.</div>
      ) : (
        <div className="space-y-3">
          {variations.map((v) => (
            <div key={v.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">
                    VO #{v.variationNumber} · {v.title}
                  </p>
                  {v.description && <p className="text-sm text-stone-500">{v.description}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{formatCents(inclMarginGst(v.totalCents))}</span>
                  <StatusBadge status={v.status} />
                </div>
              </div>

              {v.lines.length > 0 && (
                <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-100 text-sm">
                  {v.lines.map((l) => (
                    <li key={l.id} className="flex justify-between py-1.5">
                      <span>{l.description} · {l.quantity}{l.unit ? ` ${l.unit}` : ""}</span>
                      <span>{formatCents(inclMarginGst(l.totalCents))}</span>
                    </li>
                  ))}
                </ul>
              )}

              {v.quotes.length > 0 && (
                <div className="mt-3 text-sm">
                  <p className="mb-1 text-xs uppercase tracking-wide text-stone-400">Subcontractor quotes</p>
                  <ul className="space-y-1">
                    {v.quotes.map((q) => (
                      <li key={q.id} className="flex justify-between">
                        <a className="text-brand underline" href={quoteUrls.get(q.id)} target="_blank" rel="noreferrer">
                          {q.vendorName} — {q.originalName}
                        </a>
                        <span>{formatCents(q.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {isBuilder && v.status === "DRAFT" && (
                  <form action={submitVariation.bind(null, projectId, v.id)}>
                    <button className="btn-ghost" type="submit">Submit for approval</button>
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
                {isBuilder && (
                  <form
                    action={attachQuote.bind(null, projectId, v.id)}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input name="vendorName" className="input !w-40" placeholder="Vendor" />
                    <input name="amount" type="number" step="0.01" className="input !w-28" placeholder="Amount $" />
                    <input name="file" type="file" required className="text-xs" />
                    <button className="btn-ghost" type="submit">Attach quote</button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
