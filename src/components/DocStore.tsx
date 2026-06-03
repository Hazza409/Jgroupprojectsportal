import { HandoverDocKind } from "@prisma/client";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { uploadHandoverDoc, deleteHandoverDoc } from "@/app/projects/[projectId]/handover/actions";

const fmtDate = (d: Date) => new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(d);

// Reusable per-project document repository for a single HandoverDocKind.
// Used by the Register, O&M Manuals, and J Group document stores.
export async function DocStore({
  projectId,
  kind,
  isBuilder,
}: {
  projectId: string;
  kind: HandoverDocKind;
  isBuilder: boolean;
}) {
  const docs = await db.handoverDocument.findMany({
    where: { projectId, kind },
    orderBy: { createdAt: "desc" },
  });
  const store = await storage();
  const rows = await Promise.all(docs.map(async (d) => ({ ...d, url: await store.url(d.fileKey) })));

  return (
    <div className="space-y-4">
      {isBuilder && (
        <form action={uploadHandoverDoc.bind(null, projectId, kind)} className="card flex flex-wrap items-end gap-3">
          <div className="grow">
            <label className="label">Title (optional)</label>
            <input name="title" className="input" placeholder="Defaults to the file name" />
          </div>
          <div className="grow">
            <label className="label">File (PDF / image / doc)</label>
            <input type="file" name="file" required className="text-sm" />
          </div>
          <button className="btn-primary" type="submit">Upload</button>
        </form>
      )}

      {rows.length === 0 ? (
        <div className="card text-stone-500">No documents in this register yet.</div>
      ) : (
        <div className="card p-0">
          <ul className="divide-y divide-stone-100">
            {rows.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <a href={d.url} target="_blank" rel="noreferrer" className="truncate text-sm text-ink underline">
                    {d.title}
                  </a>
                  <p className="text-xs text-stone-400">{d.originalName} · {fmtDate(d.createdAt)}</p>
                </div>
                {isBuilder && (
                  <form action={deleteHandoverDoc.bind(null, projectId, d.id)}>
                    <button className="text-xs text-red-700 dark:text-red-300 hover:text-red-200" type="submit">Delete</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
