import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { Role } from "@prisma/client";
import { BrandMark } from "@/components/BrandMark";

// Public landing. Echoes the brand cover: bold uppercase grotesque on ebony black.
export default async function HomePage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === Role.BUILDER ? "/builder" : "/projects");

  return (
    <main className="relative flex min-h-screen flex-col justify-between overflow-hidden bg-base px-6 py-10 sm:px-12 sm:py-14">
      <div className="flex items-center gap-3 text-ink">
        <BrandMark className="h-6 w-5" />
        <span className="wordmark text-lg">J Group Projects</span>
      </div>

      <div className="max-w-5xl">
        <h1 className="display text-ink text-[clamp(2.75rem,11vw,7rem)]">
          Delivering
          <br />
          your vision
        </h1>
        <p className="mt-8 max-w-md text-stone-500">
          The client &amp; builder portal for J Group Projects — estimates, cost-to-complete,
          progress claims, variations, schedule and site updates, for every build.
        </p>
        <div className="mt-8">
          <Link href="/login" className="btn-primary">
            Sign in
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.25em] text-stone-500">
        <span>Design · Construction · Landscape</span>
        <span className="hidden sm:inline">Sydney</span>
      </div>
    </main>
  );
}
