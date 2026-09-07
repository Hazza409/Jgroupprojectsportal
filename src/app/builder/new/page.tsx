import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { Role } from "@prisma/client";
import { TopBar } from "@/components/TopBar";
import { CreateJobForm } from "./CreateJobForm";
import { getCompany } from "@/lib/company";

// Builder-only: create a new job (project), optionally provisioning client access.
export default async function NewJobPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.BUILDER) redirect("/projects");
  const company = await getCompany();

  return (
    <>
      <TopBar user={user} />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <Link href="/builder" className="text-sm text-stone-500 hover:text-ink">← All projects</Link>
          <h1 className="mt-2 text-2xl font-semibold">Create job</h1>
          <p className="text-sm text-stone-500">Set up a new project and, if you like, the client&apos;s login.</p>
        </div>
        <CreateJobForm companyMarginPercent={company.marginPercent} />
      </main>
    </>
  );
}
