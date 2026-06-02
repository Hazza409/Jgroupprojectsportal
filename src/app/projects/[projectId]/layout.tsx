import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { db } from "@/lib/db";
import { TopBar } from "@/components/TopBar";
import { ProjectNav } from "@/components/ProjectNav";

// Every page under /projects/[projectId] passes through this scope guard.
// A client hitting a project they don't belong to gets a 404 (no existence leak).
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { projectId: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (!(await canAccessProject(user, params.projectId))) notFound();

  const project = await db.project.findUnique({
    where: { id: params.projectId },
    select: { id: true, name: true, address: true },
  });
  if (!project) notFound();

  return (
    <>
      <TopBar user={user} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <p className="text-sm text-stone-500">{project.address ?? "No address"}</p>
        </div>
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <aside className="md:sticky md:top-6 md:self-start">
            <ProjectNav projectId={project.id} />
          </aside>
          <section className="min-w-0">{children}</section>
        </div>
      </div>
    </>
  );
}
