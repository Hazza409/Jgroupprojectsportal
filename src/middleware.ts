import { withAuth } from "next-auth/middleware";

// Gate the dashboard. Fine-grained project scoping happens at the query layer
// (src/lib/scope.ts); this just ensures a valid session before any /builder or
// /projects route renders. Unauthenticated users are redirected to /login.
export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: ["/builder/:path*", "/projects/:path*"],
};
