import { NextResponse } from "next/server";

// Which commit is actually serving. Exists because "has the deploy landed?"
// was previously unanswerable from outside: zero-downtime deploys show no
// blip, and hashed asset names only prove that A build changed, not which.
//
// Deliberately unauthenticated — it must work while auth (or the database) is
// broken, which is exactly when it's needed. It exposes only the short commit
// SHA of a private repo: no dependency versions, no environment, no data.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    // Render injects RENDER_GIT_COMMIT at build time; local dev has neither.
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "dev",
  });
}
