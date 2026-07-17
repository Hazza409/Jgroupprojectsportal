import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { PrintButton } from "./PrintButton";

const fmtDate = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-AU", { dateStyle: "long" }).format(d) : "—");

// Standalone, light-themed, branded Questions & Answers document for the client
// (Save as PDF from the browser print dialog). Lives OUTSIDE the project layout,
// so it enforces access + the client-view guard itself.
export default async function QaPrintPage({ params }: { params: { projectId: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { projectId } = params;
  if (!(await canAccessProject(user, projectId))) notFound();
  const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true, address: true, clientName: true, clientView: true } });
  if (!project) notFound();
  // Q&A is a construction module — hidden from a client on the Handover view.
  if (user.role === "CLIENT" && project.clientView === "HANDOVER") notFound();

  const company = await getCompany();
  const rfis = await db.rfi.findMany({
    where: { projectId },
    orderBy: { number: "asc" },
    include: { attachments: { select: { originalName: true } } },
  });

  return (
    <div className="min-h-screen bg-neutral-200 py-8 text-black print:bg-white print:py-0">
      <style>{`@media print { @page { margin: 16mm; } body { background: #fff !important; } }`}</style>

      <div className="mx-auto max-w-[820px] bg-white p-10 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <div className="mb-6 flex items-center justify-between print:hidden">
          <span className="text-sm text-neutral-500">Questions &amp; Answers — preview</span>
          <PrintButton />
        </div>

        {/* Brand header */}
        <header className="flex items-start justify-between border-b border-neutral-300 pb-5">
          <div>
            <div className="font-display text-xl font-light tracking-tight">{company.name}</div>
            {company.tagline && (
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-neutral-400">{company.tagline}</div>
            )}
          </div>
          <div className="text-right">
            <div className="font-display text-lg font-light">Questions &amp; Answers</div>
            <div className="text-sm text-neutral-500">{fmtDate(new Date())}</div>
          </div>
        </header>

        <section className="mt-6 text-sm">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Project</div>
          <div className="mt-1 font-medium">{project.name}</div>
          <div className="text-neutral-500">{project.address ?? ""}</div>
          {project.clientName && <div className="text-neutral-500">Client: {project.clientName}</div>}
        </section>

        {rfis.length === 0 ? (
          <p className="mt-8 text-neutral-500">No questions or decisions recorded.</p>
        ) : (
          <div className="mt-6 divide-y divide-neutral-200">
            {rfis.map((r) => {
              const isDecision = r.kind === "DECISION";
              return (
                <div key={r.id} className="py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="font-medium">
                      <span className="text-neutral-400">{isDecision ? "Decision" : "Query"} #{r.number}</span> · {r.subject}
                    </div>
                    <div className="text-xs uppercase tracking-wide text-neutral-500">{r.status}</div>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap font-semibold">{r.question}</p>
                  {isDecision && r.optionsProvided && (
                    <p className="mt-1 whitespace-pre-wrap text-sm"><span className="text-neutral-400">Options:</span> {r.optionsProvided}</p>
                  )}
                  {isDecision && r.impactIfLate && (
                    <p className="mt-1 text-sm"><span className="text-neutral-400">If late:</span> {r.impactIfLate}</p>
                  )}
                  {r.dueDate && <p className="mt-1 text-xs text-neutral-500">Needed by {fmtDate(r.dueDate)}</p>}
                  {r.answer && (
                    <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-sm">
                      <span className="text-neutral-400">Response: </span>
                      <span className="whitespace-pre-wrap">{r.answer}</span>
                    </div>
                  )}
                  {r.attachments.length > 0 && (
                    <p className="mt-1 text-xs text-neutral-500">Attachments: {r.attachments.map((a) => a.originalName).join(", ")}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
