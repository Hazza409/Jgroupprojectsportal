/* eslint-disable @next/next/no-img-element */
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ModuleHeader } from "@/components/ModuleHeader";
import { createUpdate, addUpdatePhotos, deleteUpdatePhoto, deleteUpdate } from "./actions";

const fmtDate = (d: Date) => new Intl.DateTimeFormat("en-AU", { dateStyle: "long" }).format(d);

// Fortnightly Summary — dated site-update entries (written summary + photos),
// authored by the builder and shown to the client. (Moved out of progress claims.)
export default async function UpdatesPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const updates = await db.projectUpdate.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { photos: { orderBy: { createdAt: "asc" } } },
  });
  const store = await storage();
  const withUrls = await Promise.all(
    updates.map(async (u) => ({
      ...u,
      photos: await Promise.all(u.photos.map(async (p) => ({ ...p, url: await store.url(p.fileKey) }))),
    })),
  );

  return (
    <div>
      <ModuleHeader
        title="Fortnightly Summary"
        description={isBuilder ? "Post a fortnightly update with a summary and photos." : "Fortnightly updates from J Group on your build."}
      />

      {isBuilder && (
        <form action={createUpdate.bind(null, projectId)} className="card mb-6 space-y-3">
          <div>
            <label className="label">Title</label>
            <input name="title" className="input" required placeholder="e.g. Fortnight to 29 May — framing & lock-up" />
          </div>
          <div>
            <label className="label">Summary — what happened in the last two weeks</label>
            <textarea name="body" rows={4} required className="input resize-y" placeholder="Works completed, milestones, anything the client should know…" />
          </div>
          <button className="btn-primary" type="submit">Post update</button>
        </form>
      )}

      {withUrls.length === 0 ? (
        <div className="card text-stone-500">No updates posted yet.</div>
      ) : (
        <div className="space-y-4">
          {withUrls.map((u) => (
            <div key={u.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{u.title}</h3>
                  <p className="text-xs text-stone-400">{fmtDate(u.createdAt)}</p>
                </div>
                {isBuilder && (
                  <form action={deleteUpdate.bind(null, projectId, u.id)}>
                    <button className="text-xs text-red-700 dark:text-red-300 hover:text-red-200" type="submit">Delete</button>
                  </form>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-stone-700">{u.body}</p>

              {u.photos.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {u.photos.map((p) => (
                    <figure key={p.id} className="group relative overflow-hidden rounded-lg border border-stone-200 bg-panel">
                      <img src={p.url} alt={p.originalName} className="aspect-square w-full object-cover" />
                      {isBuilder && (
                        <form action={deleteUpdatePhoto.bind(null, projectId, p.id)} className="absolute right-1 top-1 opacity-0 group-hover:opacity-100">
                          <button className="rounded bg-base/90 px-2 py-0.5 text-xs text-red-700 dark:text-red-300 ring-1 ring-red-500/30 dark:ring-red-400/30" type="submit">Delete</button>
                        </form>
                      )}
                    </figure>
                  ))}
                </div>
              )}

              {isBuilder && (
                <form action={addUpdatePhotos.bind(null, projectId, u.id)} className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
                  <input type="file" name="files" accept="image/*" multiple required className="text-xs" />
                  <button className="btn-ghost !px-3 !py-1.5 text-xs" type="submit">Add photos</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
