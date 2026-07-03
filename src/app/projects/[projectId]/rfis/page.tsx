import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { createRfi, answerRfi, closeRfi, deleteRfi } from "./actions";
import { getCompany, companyShortName } from "@/lib/company";

const fmtDate = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(d) : null);

// RFI register — the builder raises design questions; the client answers.
export default async function RfisPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  const rfis = await db.rfi.findMany({ where: { projectId }, orderBy: { number: "desc" } });

  return (
    <div>
      <ModuleHeader
        title="RFIs"
        description={isBuilder ? "Raise design questions for the client to answer." : `Design questions from ${companyShortName(company)} — please answer.`}
      />

      {isBuilder && (
        <form action={createRfi.bind(null, projectId)} className="card mb-6 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Subject</label>
            <input name="subject" className="input" required placeholder="e.g. Kitchen splashback tile" />
          </div>
          <div>
            <label className="label">Response needed by (optional)</label>
            <input name="dueDate" type="date" className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Question</label>
            <textarea name="question" rows={3} required className="input resize-y" placeholder="What's the question for the client?" />
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">Raise RFI</button>
          </div>
        </form>
      )}

      {rfis.length === 0 ? (
        <div className="card text-stone-500">No RFIs yet.</div>
      ) : (
        <div className="space-y-3">
          {rfis.map((r) => (
            <div key={r.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="text-stone-400">RFI #{r.number}</span> · {r.subject}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-stone-500">{r.question}</p>
                  {r.dueDate && r.status === "OPEN" && (
                    <p className="mt-1 text-xs text-stone-400">Response needed by {fmtDate(r.dueDate)}</p>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </div>

              {r.answer && (
                <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-stone-400">Client response</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{r.answer}</p>
                </div>
              )}

              {/* Client answers an open RFI */}
              {!isBuilder && r.status === "OPEN" && (
                <form action={answerRfi.bind(null, projectId, r.id)} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="grow">
                    <label className="label">Your answer</label>
                    <textarea name="answer" rows={2} required className="input resize-y" placeholder="Type your response…" />
                  </div>
                  <button className="btn-primary" type="submit">Submit answer</button>
                </form>
              )}

              {/* Builder actions */}
              {isBuilder && (
                <div className="mt-3 flex items-center gap-3 border-t border-stone-100 pt-3">
                  {r.status === "ANSWERED" && (
                    <form action={closeRfi.bind(null, projectId, r.id)}>
                      <button className="btn-ghost" type="submit">Close RFI</button>
                    </form>
                  )}
                  {r.status === "OPEN" && <span className="text-xs text-stone-400">Awaiting client response</span>}
                  <form action={deleteRfi.bind(null, projectId, r.id)} className="ml-auto">
                    <button className="text-xs text-red-700 dark:text-red-300 hover:text-red-200" type="submit">Delete</button>
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
