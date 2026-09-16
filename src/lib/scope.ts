// ─────────────────────────────────────────────────────────────
// SECURITY: row-level tenancy + project scoping. Treat this as a
// requirement, not a convenience. Every project-bound query/mutation
// MUST resolve access through these helpers before touching data.
//
//   BUILDER → may access all projects OF THEIR OWN COMPANY.
//   CLIENT  → may access ONLY projects they hold a membership for,
//             and only within their own company (defense in depth —
//             a membership row must never bridge two companies).
//
// Checks are expressed as DB joins keyed on user.id — never on values
// carried in the JWT — so a stale or tampered token can not widen
// access. The UI also hides things, but the UI is not the boundary —
// this is.
// ─────────────────────────────────────────────────────────────

import { Role } from "@prisma/client";
import { db } from "./db";
import { getSessionUser, type SessionUser } from "@/auth";

export class AccessError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "AccessError";
  }
}

/** A session user whose companyId has been re-read from the DB (authoritative). */
export type CompanyUser = SessionUser & { companyId: string };

/**
 * The user's company, fresh from the DB. Use THIS (not the JWT claim) whenever
 * companyId gates a read or write.
 */
export async function userCompanyId(userId: string): Promise<string | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { companyId: true } });
  return u?.companyId ?? null;
}

/**
 * Returns the project IDs a user is allowed to see.
 * Builders: all projects of their company. Clients: their memberships
 * (constrained to their own company).
 */
export async function accessibleProjectIds(user: SessionUser): Promise<string[]> {
  if (user.role === Role.BUILDER) {
    const own = await db.project.findMany({
      where: { company: { users: { some: { id: user.id } } } },
      select: { id: true },
    });
    return own.map((p) => p.id);
  }
  const memberships = await db.projectMembership.findMany({
    where: {
      userId: user.id,
      project: { company: { users: { some: { id: user.id } } } },
    },
    select: { projectId: true },
  });
  return memberships.map((m) => m.projectId);
}

/** True if the user may access the given project. */
export async function canAccessProject(user: SessionUser, projectId: string): Promise<boolean> {
  if (user.role === Role.BUILDER) {
    const count = await db.project.count({
      where: { id: projectId, company: { users: { some: { id: user.id } } } },
    });
    return count > 0;
  }
  const count = await db.projectMembership.count({
    where: {
      userId: user.id,
      projectId,
      project: { company: { users: { some: { id: user.id } } } },
    },
  });
  return count > 0;
}

/**
 * Throw unless the user may access the project. Use at the top of every
 * project-scoped page/route/action. Returns the SessionUser for convenience.
 */
export async function assertProjectAccess(projectId: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AccessError("Not authenticated");
  if (!(await canAccessProject(user, projectId))) {
    throw new AccessError("You do not have access to this project");
  }
  return user;
}

/**
 * Throw unless the current user is a BUILDER. Returns the user with their
 * companyId re-read from the DB, so callers can company-scope queries and
 * writes without trusting the JWT.
 */
export async function assertBuilder(): Promise<CompanyUser> {
  const user = await getSessionUser();
  if (!user) throw new AccessError("Not authenticated");
  if (user.role !== Role.BUILDER) throw new AccessError("Builder access required");
  const companyId = await userCompanyId(user.id);
  if (!companyId) throw new AccessError("Account has no company");
  return { ...user, companyId };
}

/**
 * Throw unless the current user is a BUILDER who may act on this project (i.e.
 * the project belongs to their company). For builder mutations that take a
 * projectId directly — e.g. deleting a job — so a guessed foreign id is refused
 * rather than acted on. Returns the company-scoped user.
 */
export async function assertBuilderForProject(projectId: string): Promise<CompanyUser> {
  const user = await assertBuilder();
  const count = await db.project.count({ where: { id: projectId, companyId: user.companyId } });
  if (count === 0) throw new AccessError("You do not have access to this project");
  return user;
}
