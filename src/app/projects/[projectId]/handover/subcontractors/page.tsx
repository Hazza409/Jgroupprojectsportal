import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { SubcontractorsUploadForm } from "./SubcontractorsUploadForm";
import { createSubcontractor, deleteSubcontractor } from "./actions";

export default async function SubcontractorsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const subs = await db.subcontractorContact.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div>
      <Link href={`/projects/${projectId}/handover`} className="text-sm text-stone-500 hover:text-ink">
        ← Handover
      </Link>
      <div className="mt-2">
        <ModuleHeader
          title="Subcontractors"
          description={
            isBuilder
              ? "The trades on this build — upload an Excel/CSV list or add them manually."
              : "Trades who worked on your home — reach them for warranty or maintenance."
          }
          action={
            isBuilder ? (
              <Link href="/api/templates/subcontractors" className="btn-ghost">Blank template</Link>
            ) : null
          }
        />
      </div>

      {isBuilder && (
        <div className="mb-6 space-y-3">
          <SubcontractorsUploadForm projectId={projectId} />

          <form action={createSubcontractor.bind(null, projectId)} className="card grid gap-3 sm:grid-cols-2">
            <p className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Or add one manually</p>
            <div>
              <label className="label">Trade</label>
              <input name="trade" className="input" placeholder="Electrical" />
            </div>
            <div>
              <label className="label">Company</label>
              <input name="company" className="input" placeholder="Bright Sparks Pty Ltd" />
            </div>
            <div>
              <label className="label">Contact</label>
              <input name="contactName" className="input" placeholder="Dave Sparks" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input name="phone" className="input" placeholder="0400 000 000" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Email</label>
              <input name="email" type="email" className="input" placeholder="name@company.com" />
            </div>
            <div className="sm:col-span-2">
              <button className="btn-primary" type="submit">Add subcontractor</button>
            </div>
          </form>
        </div>
      )}

      {subs.length === 0 ? (
        <div className="card text-stone-500">No subcontractors added yet.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {subs.map((s) => {
            const sub = [s.trade, s.company && s.contactName ? s.contactName : null].filter(Boolean).join(" · ");
            return (
              <div key={s.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{s.company || s.contactName}</p>
                    {sub && <p className="text-sm text-stone-500">{sub}</p>}
                    <div className="mt-2 space-y-1 text-sm">
                      {s.phone && (
                        <p>
                          <a href={`tel:${s.phone.replace(/\s+/g, "")}`} className="text-brand hover:underline">{s.phone}</a>
                        </p>
                      )}
                      {s.email && (
                        <p>
                          <a href={`mailto:${s.email}`} className="text-brand hover:underline break-all">{s.email}</a>
                        </p>
                      )}
                    </div>
                  </div>
                  {isBuilder && (
                    <form action={deleteSubcontractor.bind(null, projectId, s.id)}>
                      <button className="text-xs text-red-700 dark:text-red-300 hover:text-red-200" type="submit">Remove</button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
