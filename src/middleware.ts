import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Gate the dashboard. Fine-grained project scoping happens at the query layer
// (src/lib/scope.ts); this just ensures a valid session before any /builder or
// /projects route renders. Unauthenticated users are redirected to /login.
//
// It also injects the current pathname into a request header so server
// components/layouts can read it via `headers()` (Next.js doesn't expose
// pathname to layouts) — the project layout uses it to enforce the builder's
// client-view switch. This runs only AFTER the auth check passes.
export default withAuth(
  function middleware(req) {
    const headers = new Headers(req.headers);
    headers.set("x-pathname", req.nextUrl.pathname);
    return NextResponse.next({ request: { headers } });
  },
  {
    pages: { signIn: "/login" },
  },
);

export const config = {
  matcher: ["/builder/:path*", "/projects/:path*"],
};
