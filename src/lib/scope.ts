// ─────────────────────────────────────────────────────────────
// SECURITY: row-level project scoping. Treat this as a requirement,
// not a convenience. Every project-bound query/mutation MUST resolve
// access through these helpers before touching project data.
//
//   BUILDER → may access ALL projects.
//   CLIENT  → may access ONLY projects they hold a membership for.
//
// The UI also hides things, but the UI is not the boundary — this is.
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

/** Returns the project IDs a user is allowed to see. Builders: all. Clients: their memberships. */
export async function accessibleProjectIds(user: SessionUser): Promise<string[]> {
  if (user.role === Role.BUILDER) {
    const all = await db.project.findMany({ select: { id: true } });
    return all.map((p) => p.id);
  }
  const memberships = await db.projectMembership.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  return memberships.map((m) => m.projectId);
}

/** True if the user may access the given project. */
export async function canAccessProject(user: SessionUser, projectId: string): Promise<boolean> {
  if (user.role === Role.BUILDER) {
    return (await db.project.count({ where: { id: projectId } })) > 0;
  }
  const count = await db.projectMembership.count({
    where: { userId: user.id, projectId },
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

/** Throw unless the current user is a BUILDER (J Group staff). */
export async function assertBuilder(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AccessError("Not authenticated");
  if (user.role !== Role.BUILDER) throw new AccessError("Builder access required");
  return user;
}
