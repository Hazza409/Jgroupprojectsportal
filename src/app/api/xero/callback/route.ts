import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { Role } from "@prisma/client";
import { exchangeCodeForTokens } from "@/lib/xero/client";
import { saveConnection } from "@/lib/xero/tokens";

// Xero redirects here after consent. Validates state against the cookie, exchanges
// the code for tokens (resolving the tenant), and persists the encrypted connection.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== Role.BUILDER) {
    return new NextResponse("Builder access required", { status: 403 });
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookie = req.cookies.get("xero_oauth")?.value;

  function fail(reason: string, projectId?: string) {
    const url = projectId
      ? new URL(`/projects/${projectId}/cost-to-complete?xero=error`, req.nextUrl.origin)
      : new URL(`/?xero=error`, req.nextUrl.origin);
    const res = NextResponse.redirect(url);
    res.cookies.delete("xero_oauth");
    console.error(`Xero callback failed: ${reason}`);
    return res;
  }

  if (!code || !state || !cookie) return fail("missing code/state/cookie");

  let parsed: { projectId: string; nonce: string };
  try {
    parsed = JSON.parse(cookie);
  } catch {
    return fail("bad cookie");
  }

  if (parsed.nonce !== state) return fail("state mismatch", parsed.projectId);
  if (!(await canAccessProject(user, parsed.projectId))) return fail("no project access", parsed.projectId);

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveConnection(parsed.projectId, tokens);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "exchange failed", parsed.projectId);
  }

  const res = NextResponse.redirect(
    new URL(`/projects/${parsed.projectId}/cost-to-complete?xero=connected`, req.nextUrl.origin),
  );
  res.cookies.delete("xero_oauth");
  return res;
}
