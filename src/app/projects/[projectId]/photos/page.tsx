/* eslint-disable @next/next/no-img-element */
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ModuleHeader } from "@/components/ModuleHeader";
import { uploadPhotos, deletePhoto, createPhotoFolder, deletePhotoFolder } from "./actions";

export default async function PhotosPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const [folders, photos] = await Promise.all([
    db.photoFolder.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    db.photo.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),
  ]);

  const store = await storage();
  const withUrls = await Promise.all(photos.map(async (p) => ({ ...p, url: await store.url(p.fileKey) })));

  // Group: each folder, then "Unfiled".
  const groups = [
    ...folders.map((f) => ({ id: f.id, name: f.name, photos: withUrls.filter((p) => p.folderId === f.id) })),
    { id: null, name: "Unfiled", photos: withUrls.filter((p) => !p.folderId) },
  ].filter((g) => g.id !== null || g.photos.length > 0);

  return (
    <div className="space-y-6">
      <ModuleHeader title="Photo Library" description="Site photos grouped into albums for the client." />

      {isBuilder && (
        <div className="space-y-3">
          {/* Create folder */}
          <form action={createPhotoFolder.bind(null, projectId)} className="card flex flex-wrap items-end gap-3">
            <div className="grow">
              <label className="label">New album</label>
              <input name="name" required className="input" placeholder="e.g. Level 3 framing, Kitchen, May site visit" />
            </div>
            <button className="btn-ghost" type="submit">Create album</button>
          </form>

          {/* Upload into an album */}
          <form action={uploadPhotos.bind(null, projectId)} className="card flex flex-wrap items-end gap-3">
            <div className="grow">
              <label className="label">Photos</label>
              <input type="file" name="files" accept="image/*" multiple required className="text-sm" />
            </div>
            <div>
              <label className="label">Album</label>
              <select name="folderId" className="input">
                <option value="">Unfiled</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            <div className="grow">
              <label className="label">Caption (optional)</label>
              <input name="caption" className="input" />
            </div>
            <button className="btn-primary" type="submit">Upload</button>
          </form>
        </div>
      )}

      {withUrls.length === 0 && folders.length === 0 ? (
        <div className="card text-stone-500">No photos yet.</div>
      ) : (
        groups.map((g) => (
          <section key={g.id ?? "unfiled"}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                {g.name} <span className="text-stone-400">· {g.photos.length}</span>
              </h3>
              {isBuilder && g.id && (
                <form action={deletePhotoFolder.bind(null, projectId, g.id)}>
                  <button className="text-xs text-stone-400 hover:text-red-300" type="submit">Delete album</button>
                </form>
              )}
            </div>
            {g.photos.length === 0 ? (
              <p className="text-sm text-stone-500">No photos in this album yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {g.photos.map((p) => (
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
          </section>
        ))
      )}
    </div>
  );
}
