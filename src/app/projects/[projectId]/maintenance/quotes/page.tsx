import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { ModuleHeader } from "@/components/ModuleHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { createQuoteRequest, respondQuote, decideQuote } from "../actions";
import { getCompany, companyShortName } from "@/lib/company";

export default async function QuoteRequestsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  const quotes = await db.quoteRequest.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });

  return (
    <div>
      <Link href={`/projects/${projectId}/maintenance`} className="text-sm text-stone-500 hover:text-ink">← Maintenance</Link>
      <div className="mt-2">
        <ModuleHeader
          title="Quote Requests"
          description={isBuilder ? "Respond to client quote requests with a price." : `Request a quote for additional work; ${companyShortName(company)} will respond.`}
        />
      </div>

      <form action={createQuoteRequest.bind(null, projectId)} className="card mb-6 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">What would you like quoted?</label>
          <input name="title" className="input" required placeholder="e.g. Re-stain the rear deck" />
        </div>
        <div>
          <label className="label">Details (optional)</label>
          <input name="description" className="input" />
        </div>
        <div className="sm:col-span-2">
          <button className="btn-primary" type="submit">Request quote</button>
        </div>
      </form>

      {quotes.length === 0 ? (
        <div className="card text-stone-500">No quote requests yet.</div>
      ) : (
        <div className="space-y-3">
          {quotes.map((q) => (
            <div key={q.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{q.title}</p>
                  {q.description && <p className="text-sm text-stone-500">{q.description}</p>}
                  {q.response && <p className="mt-2 text-sm text-stone-600">{companyShortName(company)}: {q.response}</p>}
                </div>
                <div className="flex items-center gap-3">
                  {q.quoteAmountCents != null && <span className="font-semibold tabular-nums">{formatCents(q.quoteAmountCents)}</span>}
                  <StatusBadge status={q.status} />
                </div>
              </div>

              {/* Builder responds while OPEN */}
              {isBuilder && q.status === "OPEN" && (
                <form action={respondQuote.bind(null, projectId, q.id)} className="mt-3 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
                  <div className="grow">
                    <label className="label">Response</label>
                    <input name="response" className="input" placeholder="Scope / inclusions" />
                  </div>
                  <div>
                    <label className="label">Quote ($)</label>
                    <input name="amount" type="number" step="0.01" className="input !w-32" placeholder="0.00" />
                  </div>
                  <button className="btn-primary" type="submit">Send quote</button>
                </form>
              )}

              {/* Either party accepts/declines once QUOTED */}
              {q.status === "QUOTED" && (
                <div className="mt-3 flex items-center gap-3 border-t border-stone-100 pt-3">
                  <form action={decideQuote.bind(null, projectId, q.id, true)}>
                    <button className="btn-primary" type="submit">Accept</button>
                  </form>
                  <form action={decideQuote.bind(null, projectId, q.id, false)}>
                    <button className="btn-ghost" type="submit">Decline</button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
