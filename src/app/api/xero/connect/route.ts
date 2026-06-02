import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { Role } from "@prisma/client";
import { getAuthorizeUrl } from "@/lib/xero/client";

// Builder-only. Kicks off Xero consent for a specific project. The project id is
// bound to the OAuth `state` via a short-lived httpOnly cookie so the callback
// can't be replayed against a different project.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== Role.BUILDER) {
    return new NextResponse("Builder access required", { status: 403 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId || !(await canAccessProject(user, projectId))) {
    return new NextResponse("Not found", { status: 404 });
  }

  const nonce = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(getAuthorizeUrl(nonce));
  res.cookies.set("xero_oauth", JSON.stringify({ projectId, nonce }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  return res;
}
