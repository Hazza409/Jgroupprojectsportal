import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { formatCents } from "@/lib/money";
import { TopBar } from "@/components/TopBar";
import { DeleteJobButton } from "./DeleteJobButton";

// BUILDER index — every project. Clients never reach this (redirected away).
export default async function BuilderHome() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.BUILDER) redirect("/projects");

  const projects = await db.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { variations: true, progressClaims: true } } },
  });

  return (
    <>
      <TopBar user={user} />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">All projects</h1>
            <p className="text-sm text-stone-500">{projects.length} project(s) · J Group staff view</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/builder/team" className="btn-ghost">Team</Link>
            <Link href="/builder/new" className="btn-primary">New job</Link>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="card text-stone-500">
            No jobs yet. <Link href="/builder/new" className="underline">Create your first job</Link>.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div key={p.id} className="card transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between">
                  <Link href={`/projects/${p.id}`} className="font-semibold hover:underline">{p.name}</Link>
                  <span className="badge bg-stone-100 text-stone-600">{p.status}</span>
                </div>
                <Link href={`/projects/${p.id}`} className="block">
                  <p className="mt-1 text-sm text-stone-500">{p.address ?? "No address"}</p>
                  <p className="mt-3 text-sm">
                    Contract <span className="font-medium">{formatCents(p.contractValueCents)}</span>
                  </p>
                  <p className="mt-1 text-xs text-stone-400">
                    {p._count.variations} variations · {p._count.progressClaims} claims
                  </p>
                </Link>
                <div className="mt-3 flex justify-end border-t border-stone-100 pt-2">
                  <DeleteJobButton projectId={p.id} name={p.name} />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
