import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { Role } from "@prisma/client";
import { TopBar } from "@/components/TopBar";
import { getCompany } from "@/lib/company";
import { storage } from "@/lib/storage";
import { SettingsForm } from "./SettingsForm";

// Company settings — builder only. White-label branding + commercial defaults
// for the whole portal (SAAS-PLAN M1).
export default async function CompanySettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.BUILDER) redirect("/projects");

  const company = await getCompany();
  const logoUrl = company.logoKey ? await (await storage()).url(company.logoKey) : null;

  return (
    <>
      <TopBar user={user} />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6">
          <Link href="/builder" className="text-sm text-stone-500 hover:text-ink">← All projects</Link>
          <h1 className="mt-2 text-2xl font-semibold">Company settings</h1>
          <p className="text-sm text-stone-500">
            Branding and commercial defaults for the whole portal — the header, landing page,
            client emails and claim documents all use these.
          </p>
        </div>
        <SettingsForm company={company} logoUrl={logoUrl} />
      </main>
    </>
  );
}
