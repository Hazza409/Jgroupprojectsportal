import Link from "next/link";
import { SignOutButton } from "./SignOutButton";
import { BrandMark } from "./BrandMark";
import type { SessionUser } from "@/auth";

export function TopBar({ user }: { user: SessionUser }) {
  return (
    <header className="border-b border-stone-200 bg-ebony">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href={user.role === "BUILDER" ? "/builder" : "/projects"} className="flex items-center gap-3">
          <BrandMark className="h-6 w-5 text-ink" />
          <span className="flex flex-col leading-none">
            <span className="wordmark text-lg text-ink">J Group Projects</span>
            <span className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-stone-500">
              Design · Construction · Landscape
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-stone-500">
            {user.name} · <span className="font-medium text-stone-700">{user.role}</span>
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
