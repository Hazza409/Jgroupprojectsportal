import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { storage } from "@/lib/storage";

// Explicit Content-Type per extension. This is NOT optional: the app sends
// X-Content-Type-Options: nosniff on every response (security headers), which
// forbids the browser from guessing — so an untyped PDF response is refused
// rather than rendered. "Clients can't open the PDFs" was exactly this.
const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
// Types a browser may render in the tab. Everything else downloads — including
// SVG, deliberately: inline SVG can carry scripts, so it must never render
// from this origin.
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/quicktime"]);

function fileHeaders(filename: string, cache: string): HeadersInit {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const type = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const disposition = INLINE.has(type) ? "inline" : "attachment";
  // ASCII-safe fallback plus RFC 5987 encoding for names with any other chars.
  const safe = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return {
    "Content-Type": type,
    "Content-Disposition": `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control": cache,
  };
}

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
        headers: fileHeaders(segments[segments.length - 1], "public, max-age=300"),
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
      headers: fileHeaders(segments[segments.length - 1], "private, max-age=60"),
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
