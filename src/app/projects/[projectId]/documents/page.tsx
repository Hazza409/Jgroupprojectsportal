import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ModuleHeader } from "@/components/ModuleHeader";
import { uploadDocument, deleteDocument } from "./actions";

// Friendly labels for the document-type enum.
const KIND_LABELS: Record<string, string> = {
  ARCHITECTURAL: "Architectural drawing",
  INTERIOR: "Interior design",
  CONTRACT: "Contract",
  INSURANCE: "Insurance",
  WARRANTY: "Warranty",
  COMPLIANCE: "Compliance certificate",
  PERMIT: "Permit / approval",
  OTHER: "Other",
};

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
        title="Documents & Drawings"
        description="Project documents shared with the client — drawings, contract, insurances, warranties, compliance certificates (PDF / image)."
      />

      {isBuilder && (
        <form action={uploadDocument.bind(null, projectId)} className="card mb-6 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Title</label>
            <input name="title" className="input" placeholder="e.g. Ground floor plan — Rev C, or Public liability certificate" />
          </div>
          <div>
            <label className="label">Type</label>
            <select name="kind" className="input">
              <option value="ARCHITECTURAL">Architectural drawing</option>
              <option value="INTERIOR">Interior design</option>
              <option value="CONTRACT">Contract</option>
              <option value="INSURANCE">Insurance</option>
              <option value="WARRANTY">Warranty</option>
              <option value="COMPLIANCE">Compliance certificate</option>
              <option value="PERMIT">Permit / approval</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">File (PDF or image)</label>
            <input type="file" name="file" accept=".pdf,image/*" required className="text-sm" />
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">Upload document</button>
          </div>
        </form>
      )}

      {withUrls.length === 0 ? (
        <div className="card text-stone-500">No documents uploaded yet.</div>
      ) : (
        <div className="space-y-2">
          {withUrls.map((d) => (
            <div key={d.id} className="card flex items-center justify-between">
              <div>
                <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-brand underline">
                  {d.title}
                </a>
                <p className="text-xs text-stone-400">{KIND_LABELS[d.kind] ?? d.kind} · {d.originalName}</p>
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
