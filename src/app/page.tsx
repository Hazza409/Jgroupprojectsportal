import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { Role } from "@prisma/client";

// Public landing. Signed-in users go straight to their dashboard.
export default async function HomePage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === Role.BUILDER ? "/builder" : "/projects");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">J Group Projects</p>
        <h1 className="mt-3 text-4xl font-semibold text-ink">Client &amp; Builder Dashboard</h1>
        <p className="mt-4 text-stone-500">
          Estimates, cost-to-complete, progress claims, variations, schedule, calendar, photos and
          drawings — for every J Group build, in one place.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login" className="btn-primary">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
