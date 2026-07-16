import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { db } from "@/lib/db";
import { TopBar } from "@/components/TopBar";
import { ProjectNav } from "@/components/ProjectNav";
import { CompanyMark } from "@/components/CompanyMark";
import { getCompany, companyShortName } from "@/lib/company";

// Module slugs grouped by the client-view they belong to. Used to enforce the
// builder's client-view switch server-side (the nav hides them too, but the UI
// is not the boundary — a client must not reach a hidden module by deep link).
const CONSTRUCTION_SLUGS = new Set([
  "estimate",
  "cost-to-complete",
  "progress-claims",
  "variations",
  "rfis",
  "schedule",
  "calendar",
  "updates",
  "photos",
  "documents",
]);
const CARE_SLUGS = new Set(["handover", "maintenance"]);

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
    select: { id: true, name: true, address: true, clientView: true },
  });
  if (!project) notFound();

  const isBuilder = user.role === "BUILDER";

  // Server-side enforcement of the client-view switch. The current path is
  // injected as a header by middleware (src/middleware.ts).
  const base = `/projects/${params.projectId}`;
  const pathname = headers().get("x-pathname") ?? "";
  const slug = (pathname.startsWith(base) ? pathname.slice(base.length) : "").replace(/^\//, "").split("/")[0];
  // Send a client who lands on a module hidden by the current client-view to
  // their overview (which is always visible) — never a 404/blank.
  if (!isBuilder) {
    const hidden =
      (project.clientView === "CONSTRUCTION" && CARE_SLUGS.has(slug)) ||
      (project.clientView === "HANDOVER" && CONSTRUCTION_SLUGS.has(slug));
    if (hidden) redirect(base);
  }

  const viewLabel = project.clientView === "HANDOVER" ? "Handover & Maintenance" : "Construction";
  const company = await getCompany();

  return (
    <>
      <TopBar user={user} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            {/* The client's project is the masthead/hero (Jake 1.1). */}
            <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
            <p className="mt-0.5 text-sm text-stone-500">{project.address ?? "No address"}</p>
          </div>
          <span className="badge bg-stone-100 text-stone-600 ring-1 ring-stone-200">
            {isBuilder ? `Client sees: ${viewLabel}` : viewLabel}
          </span>
        </div>
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <aside className="space-y-6 md:sticky md:top-6 md:self-start">
            <ProjectNav
              projectId={project.id}
              clientView={project.clientView}
              isBuilder={isBuilder}
              contactsLabel={`${companyShortName(company)} Contacts`}
            />
            {/* Quiet brand signature, bottom-left (Jake §1.1: our name is the
                signature — small and understated, not a masthead). */}
            <div className="flex items-center gap-2 px-3 pt-4 opacity-60">
              <CompanyMark company={company} className="h-5 w-5 text-stone-400" imgClassName="h-5 w-auto" />
              <span className="wordmark text-xs text-stone-400">{company.name}</span>
            </div>
          </aside>
          <section className="min-w-0">{children}</section>
        </div>
      </div>
    </>
  );
}
