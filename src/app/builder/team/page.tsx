import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { TopBar } from "@/components/TopBar";
import { StaffForm } from "./StaffForm";
import { getCompany, companyShortName } from "@/lib/company";

// Builder-only: manage J Group staff (project-manager logins). All builders see
// every project and receive the team notification emails.
export default async function TeamPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.BUILDER) redirect("/projects");
  const company = await getCompany();

  const staff = await db.user.findMany({
    where: { role: Role.BUILDER },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, createdAt: true },
  });

  const fmt = (d: Date) => new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(d);

  return (
    <>
      <TopBar user={user} />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <Link href="/builder" className="text-sm text-stone-500 hover:text-ink">← All projects</Link>
          <h1 className="mt-2 text-2xl font-semibold">Team</h1>
          <p className="text-sm text-stone-500">
            Project-manager logins for {companyShortName(company)} staff. Everyone here receives email alerts when a
            client requests a meeting or approves a variation.
          </p>
        </div>

        <div className="mb-8 max-w-3xl">
          <StaffForm />
        </div>

        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {staff.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-medium">
                    {s.name}
                    {s.id === user.id && <span className="ml-2 text-xs text-stone-400">(you)</span>}
                  </td>
                  <td className="px-4 py-2">{s.email}</td>
                  <td className="px-4 py-2 text-stone-500">Project manager</td>
                  <td className="px-4 py-2 text-stone-500">{fmt(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
