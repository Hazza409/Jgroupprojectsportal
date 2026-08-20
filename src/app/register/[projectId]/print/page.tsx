import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { getCompany } from "@/lib/company";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { PrintButton } from "./PrintButton";

const ACTION_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ACKNOWLEDGED: "Acknowledged (receipt)",
  ANSWERED: "Answered",
  // J Group's own act, not a client decision — the register would otherwise
  // show what the client agreed to but never when they were told.
  PUBLISHED: "Issued to client",
};

/**
 * Decision Register — the immutable, dated record of every decision on the
 * project: the client's approvals, rejections, acknowledgements and query
 * answers, AND J Group's own issuing of revised forecast figures (Jake §2).
 * Both halves matter in a dispute: what the client agreed to, and when they
 * were told. Exported untouched to a QS or lawyer. Append-only: nothing in this
 * document can be edited after the fact; corrections appear as later entries.
 */
export default async function DecisionRegisterPage({ params }: { params: { projectId: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { projectId } = params;
  if (!(await canAccessProject(user, projectId))) notFound();
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { name: true, address: true, clientName: true, clientView: true },
  });
  if (!project) notFound();
  if (user.role === "CLIENT" && project.clientView === "HANDOVER") notFound();

  const company = await getCompany();
  const records = await db.decisionRecord.findMany({
    where: { projectId },
    orderBy: { occurredAt: "asc" },
  });

  const counts = {
    approved: records.filter((r) => r.action === "APPROVED").length,
    rejected: records.filter((r) => r.action === "REJECTED").length,
    acknowledged: records.filter((r) => r.action === "ACKNOWLEDGED").length,
    answered: records.filter((r) => r.action === "ANSWERED").length,
  };

  return (
    <div className="min-h-screen bg-neutral-200 py-8 text-black print:bg-white print:py-0">
      <style>{`@media print { @page { margin: 14mm; } body { background: #fff !important; } }`}</style>

      <div className="mx-auto max-w-[900px] bg-white p-10 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <div className="mb-6 flex items-center justify-between print:hidden">
          <span className="text-sm text-neutral-500">Decision register — preview</span>
          <PrintButton />
        </div>

        <header className="flex items-start justify-between border-b border-neutral-300 pb-5">
          <div>
            <div className="font-display text-xl font-light tracking-tight">{company.name}</div>
            {company.tagline && (
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-neutral-400">{company.tagline}</div>
            )}
          </div>
          <div className="text-right">
            <div className="font-display text-lg font-light">Decision Register</div>
            <div className="text-sm text-neutral-500">Issued {fmtDate(new Date())}</div>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-400">Project</div>
            <div className="mt-1 font-medium">{project.name}</div>
            <div className="text-neutral-500">{project.address ?? ""}</div>
            {project.clientName && <div className="text-neutral-500">Client: {project.clientName}</div>}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-neutral-400">Entries</div>
            <div className="mt-1">{records.length} recorded</div>
            <div className="text-neutral-500">
              {counts.approved} approved · {counts.rejected} rejected · {counts.acknowledged} acknowledged · {counts.answered} answered
            </div>
          </div>
        </section>

        {records.length === 0 ? (
          <p className="mt-8 text-neutral-500">No decisions recorded yet.</p>
        ) : (
          <table className="mt-6 w-full table-fixed text-xs">
            <colgroup>
              <col className="w-[17%]" />
              <col className="w-[19%]" />
              <col className="w-[15%]" />
              <col className="w-[18%]" />
              <col className="w-[13%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead className="border-b border-neutral-300 text-left uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="py-2 pr-2">Date &amp; time</th>
                <th className="py-2 pr-2">Item</th>
                <th className="py-2 pr-2">Action</th>
                <th className="py-2 pr-2">By</th>
                <th className="py-2 pr-2 text-right">Amount</th>
                <th className="py-2">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 align-top">
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-2 whitespace-nowrap">{fmtDateTime(r.occurredAt)}</td>
                  <td className="py-2 pr-2">
                    <div className="font-medium">{r.subjectRef}</div>
                    {r.subjectTitle && <div className="text-neutral-500">{r.subjectTitle}</div>}
                  </td>
                  <td className="py-2 pr-2">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="py-2 pr-2">
                    <div>{r.actorName}</div>
                    <div className="text-neutral-500">{r.actorEmail}</div>
                    <div className="text-neutral-400">{r.actorRole === "BUILDER" ? company.name : "Client"}</div>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {r.amountCents != null ? formatCents(r.amountCents) : "—"}
                  </td>
                  <td className="py-2 break-words">
                    {r.detail ?? "—"}
                    {r.versionHash && (
                      <div className="mt-0.5 font-mono text-[9px] text-neutral-400">version {r.versionHash}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-8 border-t border-neutral-200 pt-3 text-[10px] leading-relaxed text-neutral-500">
          This register is an append-only record generated by the {company.name} client portal. Each entry records the
          acting user, the exact date and time of the action, and where applicable the amount and a fingerprint of the
          exact version of the document acted upon. Entries are never edited or removed; corrections appear as
          subsequent entries. Acknowledgements record receipt only and do not constitute approval of cost.
        </p>
      </div>
    </div>
  );
}
