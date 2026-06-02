import Link from "next/link";
import { SignOutButton } from "./SignOutButton";
import type { SessionUser } from "@/auth";

export function TopBar({ user }: { user: SessionUser }) {
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <Link href={user.role === "BUILDER" ? "/builder" : "/projects"} className="flex items-center gap-2">
          <span className="text-sm font-semibold uppercase tracking-widest text-brand">J Group</span>
          <span className="text-sm text-stone-400">Dashboard</span>
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
