/* eslint-disable @next/next/no-img-element */
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ModuleHeader } from "@/components/ModuleHeader";
import { uploadPhotos, deletePhoto } from "./actions";

export default async function PhotosPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const photos = await db.photo.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
  const store = await storage();
  const withUrls = await Promise.all(photos.map(async (p) => ({ ...p, url: await store.url(p.fileKey) })));

  return (
    <div>
      <ModuleHeader title="Photo Library" description="Per-project site photos, updated fortnightly." />

      {isBuilder && (
        <form action={uploadPhotos.bind(null, projectId)} className="card mb-6 flex flex-wrap items-end gap-3">
          <div className="grow">
            <label className="label">Photos</label>
            <input type="file" name="files" accept="image/*" multiple required className="text-sm" />
          </div>
          <div className="grow">
            <label className="label">Caption (optional)</label>
            <input name="caption" className="input" />
          </div>
          <button className="btn-primary" type="submit">Upload</button>
        </form>
      )}

      {withUrls.length === 0 ? (
        <div className="card text-stone-500">No photos yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {withUrls.map((p) => (
            <figure key={p.id} className="group relative overflow-hidden rounded-lg border border-stone-200 bg-panel">
              <img src={p.url} alt={p.caption ?? p.originalName} className="aspect-square w-full object-cover" />
              {p.caption && <figcaption className="p-2 text-xs text-stone-500">{p.caption}</figcaption>}
              {isBuilder && (
                <form action={deletePhoto.bind(null, projectId, p.id)} className="absolute right-1 top-1 opacity-0 group-hover:opacity-100">
                  <button className="rounded bg-base/90 px-2 py-0.5 text-xs text-red-300 ring-1 ring-red-400/30" type="submit">Delete</button>
                </form>
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
