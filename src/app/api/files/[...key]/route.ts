import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { storage } from "@/lib/storage";

// Serves files from the local storage driver, but ONLY after re-checking project
// scope. Keys are of the form: projects/{projectId}/{category}/{name}. We derive
// the projectId from the key and verify the caller may access that project — so
// a guessed/leaked key from another project still 404s.
// Exception: company/{companyId}/... keys are PUBLIC branding assets (the logo
// shows on the public landing/login pages) — no auth, but nothing sensitive
// may ever be stored under company/.
export async function GET(_req: NextRequest, { params }: { params: { key: string[] } }) {
  // Next has already decoded the path segments once. Do NOT decode again — a
  // second decode lets "%252e%252e" survive as ".." and makes the authorized
  // path (segments[1]) diverge from the served path (segments.join). Reject any
  // segment that is empty or contains traversal/separator characters so the
  // path we authorize is exactly the path we read.
  const segments = params.key;
  if (segments.some((seg) => !seg || seg === "." || seg === ".." || seg.includes("/") || seg.includes("\\"))) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (segments[0] === "company" && segments.length >= 3) {
    try {
      const store = await storage();
      const bytes = await store.get(segments.join("/"));
      return new NextResponse(new Uint8Array(bytes), {
        headers: { "Cache-Control": "public, max-age=300" },
      });
    } catch {
      return new NextResponse("Not found", { status: 404 });
    }
  }

  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

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
