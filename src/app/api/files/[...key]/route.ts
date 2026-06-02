import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { storage } from "@/lib/storage";

// Serves files from the local storage driver, but ONLY after re-checking project
// scope. Keys are of the form: projects/{projectId}/{category}/{name}. We derive
// the projectId from the key and verify the caller may access that project — so
// a guessed/leaked key from another project still 404s.
export async function GET(_req: NextRequest, { params }: { params: { key: string[] } }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const segments = params.key.map(decodeURIComponent);
  if (segments[0] !== "projects" || segments.length < 4) {
    return new NextResponse("Not found", { status: 404 });
  }
  const projectId = segments[1];
  if (!(await canAccessProject(user, projectId))) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const store = await storage();
    const bytes = await store.get(segments.join("/"));
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
