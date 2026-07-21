import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ModuleHeader } from "@/components/ModuleHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { createRfi, answerRfi, closeRfi, deleteRfi, addRfiAttachments, deleteRfiAttachment } from "./actions";
import { getCompany, companyShortName } from "@/lib/company";

const fmtDate = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(d) : null);

// Questions & Answers — the builder raises design questions or decisions the
// client must make; the client answers. Supporting files can be attached.
export default async function RfisPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";
  const company = await getCompany();

  const rfis = await db.rfi.findMany({
    where: { projectId },
    orderBy: { number: "desc" },
    include: { attachments: { orderBy: { createdAt: "asc" } } },
  });
  const store = await storage();
  const withUrls = await Promise.all(
    rfis.map(async (r) => ({
      ...r,
      attachments: await Promise.all(r.attachments.map(async (a) => ({ ...a, url: await store.url(a.fileKey) }))),
    })),
  );

  return (
    <div>
      <ModuleHeader
        title="Questions & Answers"
        description={isBuilder ? "Raise questions or decisions for the client to answer." : `Questions & decisions from ${companyShortName(company)} — please respond.`}
        action={
          rfis.length > 0 ? (
            <a href={`/qa/${projectId}/print`} target="_blank" rel="noreferrer" className="btn-ghost">Download PDF</a>
          ) : null
        }
      />

      {isBuilder && (
        <form action={createRfi.bind(null, projectId)} className="card mb-6 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Subject</label>
            <input name="subject" className="input" required placeholder="e.g. Kitchen splashback tile" />
          </div>
          <div>
            <label className="label">Type</label>
            <select name="kind" className="input" defaultValue="QUESTION">
              <option value="QUESTION">Question</option>
              <option value="DECISION">Decision / selection needed</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Details</label>
            <textarea name="question" rows={3} required className="input resize-y" placeholder="What's the question or decision for the client?" />
          </div>
          <div>
            <label className="label">Needed by (optional)</label>
            <input name="dueDate" type="date" className="input" />
          </div>
          <div>
            <label className="label">Attach files (PDF or image, optional)</label>
            <input type="file" name="files" accept=".pdf,image/*" multiple className="text-sm" />
          </div>
          <div>
            <label className="label">Options offered <span className="text-stone-400">(decisions — one per line)</span></label>
            <textarea name="optionsProvided" rows={3} className="input resize-y" placeholder={"Honed marble\nQuartz — Caesarstone\nPorcelain"} />
          </div>
          <div>
            <label className="label">Cost / time impact if late <span className="text-stone-400">(decisions only)</span></label>
            <input name="impactIfLate" className="input" placeholder="e.g. Holds tiling; ~1 week delay" />
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">Raise</button>
          </div>
        </form>
      )}

      {withUrls.length === 0 ? (
        <div className="card text-stone-500">No questions yet.</div>
      ) : (
        <div className="space-y-3">
          {withUrls.map((r) => {
            const isDecision = r.kind === "DECISION";
            const options = r.optionsProvided
              ? r.optionsProvided.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
              : [];
            return (
            <div key={r.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="text-stone-400">{isDecision ? "Decision" : "Query"} #{r.number}</span> · {r.subject}
                    {isDecision && (
                      <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        Decision needed
                      </span>
                    )}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-base font-semibold text-ink">{r.question}</p>
                  {isDecision && options.length > 0 && (
                    <div className="mt-1 text-sm text-stone-600">
                      <span className="text-stone-400">Options:</span>
                      <ul className="mt-0.5 list-disc pl-5">
                        {options.map((o, i) => <li key={i}>{o}</li>)}
                      </ul>
                    </div>
                  )}
                  {isDecision && r.impactIfLate && (
                    <p className="mt-1 text-sm text-stone-600"><span className="text-stone-400">If late:</span> {r.impactIfLate}</p>
                  )}
                  {r.dueDate && r.status === "OPEN" && (
                    <p className="mt-1 text-xs text-stone-400">Needed by {fmtDate(r.dueDate)}</p>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </div>

              {/* Attachments */}
              {r.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.attachments.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs">
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-brand underline">📎 {a.originalName}</a>
                      {isBuilder && (
                        <form action={deleteRfiAttachment.bind(null, projectId, a.id)}>
                          <button type="submit" className="text-stone-400 hover:text-red-500" title="Remove">✕</button>
                        </form>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {r.answer && (
                <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-stone-400">Client response</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{r.answer}</p>
                </div>
              )}

              {/* Client answers an open item */}
              {!isBuilder && r.status === "OPEN" && (
                isDecision && options.length > 0 ? (
                  <form action={answerRfi.bind(null, projectId, r.id)} className="mt-3 space-y-2">
                    <label className="label">Choose an option</label>
                    <div className="space-y-1.5">
                      {options.map((o, i) => (
                        <label key={i} className="flex items-center gap-2 text-sm">
                          <input type="radio" name="selectedOption" value={o} required className="accent-brand" />
                          {o}
                        </label>
                      ))}
                    </div>
                    <textarea name="note" rows={2} className="input resize-y" placeholder="Add a note (optional)…" />
                    <button className="btn-primary" type="submit">Submit decision</button>
                  </form>
                ) : (
                  <form action={answerRfi.bind(null, projectId, r.id)} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="grow">
                      <label className="label">{isDecision ? "Your decision" : "Your answer"}</label>
                      <textarea name="answer" rows={2} required className="input resize-y" placeholder={isDecision ? "Tell us your decision…" : "Type your response…"} />
                    </div>
                    <button className="btn-primary" type="submit">Submit</button>
                  </form>
                )
              )}

              {/* Builder actions */}
              {isBuilder && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-3">
                  <form action={addRfiAttachments.bind(null, projectId, r.id)} className="flex items-center gap-2">
                    <input type="file" name="files" accept=".pdf,image/*" multiple required className="text-xs" />
                    <button className="btn-ghost !px-3 !py-1.5 text-xs" type="submit">Attach</button>
                  </form>
                  {r.status === "ANSWERED" && (
                    <form action={closeRfi.bind(null, projectId, r.id)}>
                      <button className="btn-ghost" type="submit">Close</button>
                    </form>
                  )}
                  {r.status === "OPEN" && <span className="text-xs text-stone-400">Awaiting client response</span>}
                  <form action={deleteRfi.bind(null, projectId, r.id)} className="ml-auto">
                    <button className="text-xs text-red-700 dark:text-red-300 hover:text-red-200" type="submit">Delete</button>
                  </form>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
