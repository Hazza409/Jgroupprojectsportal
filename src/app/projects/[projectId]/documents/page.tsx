import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ModuleHeader } from "@/components/ModuleHeader";
import { uploadDocument, deleteDocument } from "./actions";

export default async function DocumentsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const docs = await db.designDocument.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
  const store = await storage();
  const withUrls = await Promise.all(docs.map(async (d) => ({ ...d, url: await store.url(d.fileKey) })));

  return (
    <div>
      <ModuleHeader
        title="Drawings & Design"
        description="Architectural and interior design documents (PDF / image)."
      />

      {isBuilder && (
        <form action={uploadDocument.bind(null, projectId)} className="card mb-6 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Title</label>
            <input name="title" className="input" placeholder="Ground floor plan — Rev C" />
          </div>
          <div>
            <label className="label">Type</label>
            <select name="kind" className="input">
              <option value="ARCHITECTURAL">Architectural</option>
              <option value="INTERIOR">Interior</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">File (PDF or image)</label>
            <input type="file" name="file" accept=".pdf,image/*" required className="text-sm" />
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">Upload drawing</button>
          </div>
        </form>
      )}

      {withUrls.length === 0 ? (
        <div className="card text-stone-500">No drawings uploaded yet.</div>
      ) : (
        <div className="space-y-2">
          {withUrls.map((d) => (
            <div key={d.id} className="card flex items-center justify-between">
              <div>
                <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-brand underline">
                  {d.title}
                </a>
                <p className="text-xs text-stone-400">{d.kind} · {d.originalName}</p>
              </div>
              {isBuilder && (
                <form action={deleteDocument.bind(null, projectId, d.id)}>
                  <button className="text-sm text-red-600 dark:text-red-300 hover:underline" type="submit">Delete</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
