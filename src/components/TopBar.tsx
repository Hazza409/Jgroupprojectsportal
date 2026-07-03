import Link from "next/link";
import { SignOutButton } from "./SignOutButton";
import { CompanyMark } from "./CompanyMark";
import { ThemeToggle } from "./ThemeToggle";
import { getCompany } from "@/lib/company";
import type { SessionUser } from "@/auth";

export async function TopBar({ user }: { user: SessionUser }) {
  const company = await getCompany();
  return (
    <header className="border-b border-stone-200 bg-chrome">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href={user.role === "BUILDER" ? "/builder" : "/projects"} className="flex items-center gap-3">
          <CompanyMark company={company} className="h-6 w-6 text-ink" imgClassName="h-6 w-auto" />
          <span className="flex flex-col leading-none">
            <span className="wordmark text-lg text-ink">{company.name}</span>
            {company.tagline && (
              <span className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-stone-500">
                {company.tagline}
              </span>
            )}
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <span className="text-sm text-stone-500">
            {user.name} · <span className="font-medium text-stone-700">{user.role}</span>
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
