import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ModuleHeader } from "@/components/ModuleHeader";
import { createWarranty, deleteWarranty } from "../actions";

const fmtDate = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(d) : "—");

export default async function WarrantiesPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const warranties = await db.warranty.findMany({ where: { projectId }, orderBy: [{ expiryDate: "asc" }, { item: "asc" }] });
  const store = await storage();
  const rows = await Promise.all(
    warranties.map(async (w) => ({ ...w, url: w.fileKey ? await store.url(w.fileKey) : null })),
  );
  const now = Date.now();

  return (
    <div>
      <Link href={`/projects/${projectId}/handover`} className="text-sm text-stone-500 hover:text-ink">← Handover</Link>
      <div className="mt-2">
        <ModuleHeader title="Warranties" description="Warranty register — issuer, item and expiry tracked as structured fields." />
      </div>

      {isBuilder && (
        <form action={createWarranty.bind(null, projectId)} className="card mb-6 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Item covered</label>
            <input name="item" className="input" required placeholder="e.g. Roof membrane" />
          </div>
          <div>
            <label className="label">Issuer</label>
            <input name="issuer" className="input" required placeholder="e.g. Acme Roofing / manufacturer" />
          </div>
          <div>
            <label className="label">Expiry date</label>
            <input name="expiryDate" type="date" className="input" />
          </div>
          <div>
            <label className="label">Certificate (optional)</label>
            <input name="file" type="file" className="text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes (optional)</label>
            <input name="notes" className="input" />
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">Add warranty</button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <div className="card text-stone-500">No warranties recorded yet.</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Issuer</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">Certificate</th>
                {isBuilder && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((w) => {
                const expired = w.expiryDate && w.expiryDate.getTime() < now;
                return (
                  <tr key={w.id}>
                    <td className="px-4 py-2">
                      {w.item}
                      {w.notes && <span className="block text-xs text-stone-400">{w.notes}</span>}
                    </td>
                    <td className="px-4 py-2 text-stone-500">{w.issuer}</td>
                    <td className={`px-4 py-2 ${expired ? "text-red-700 dark:text-red-300" : ""}`}>
                      {fmtDate(w.expiryDate)}{expired ? " · expired" : ""}
                    </td>
                    <td className="px-4 py-2">
                      {w.url ? (
                        <a href={w.url} target="_blank" rel="noreferrer" className="text-ink underline">{w.originalName ?? "View"}</a>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    {isBuilder && (
                      <td className="px-4 py-2 text-right">
                        <form action={deleteWarranty.bind(null, projectId, w.id)}>
                          <button className="text-xs text-red-700 dark:text-red-300 hover:text-red-200" type="submit">Delete</button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
