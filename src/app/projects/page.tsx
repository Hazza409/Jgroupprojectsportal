import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { db } from "@/lib/db";
import { accessibleProjectIds } from "@/lib/scope";
import { formatCents } from "@/lib/money";
import { TopBar } from "@/components/TopBar";

// Project list scoped to the current user. Clients see ONLY their memberships;
// builders see all (but normally land on /builder).
export default async function ProjectsIndex() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const ids = await accessibleProjectIds(user);
  const projects = await db.project.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: "desc" },
  });

  // Common case for a high-end client: exactly one project → go straight in.
  if (user.role === "CLIENT" && projects.length === 1) {
    redirect(`/projects/${projects[0].id}`);
  }

  return (
    <>
      <TopBar user={user} />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-semibold">Your projects</h1>
        {projects.length === 0 ? (
          <div className="card text-stone-500">You don&apos;t have access to any projects yet.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="card transition-shadow hover:shadow-md">
                <h2 className="font-semibold">{p.name}</h2>
                <p className="mt-1 text-sm text-stone-500">{p.address ?? "No address"}</p>
                <p className="mt-3 text-sm">
                  Contract <span className="font-medium">{formatCents(p.contractValueCents)}</span>
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
