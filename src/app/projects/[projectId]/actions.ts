"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { ProjectPhase, Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";

export interface SimpleResult { ok: boolean; message: string }

// Builder sets/resets a client's login password. Scoped: the target user must be
// a CLIENT member of THIS project.
export async function setClientPassword(projectId: string, userId: string, formData: FormData): Promise<SimpleResult> {
  const actor = await assertProjectAccess(projectId);
  if (actor.role !== Role.BUILDER) throw new AccessError("Only builders manage client access");

  // Trim accidental edge whitespace — login compares exactly, so a stray space
  // would silently break sign-in.
  const password = String(formData.get("password") ?? "").trim();
  if (password.length < 8) return { ok: false, message: "Password must be at least 8 characters." };

  const membership = await db.projectMembership.findFirst({
    where: { projectId, userId, user: { role: Role.CLIENT } },
    include: { user: { select: { email: true } } },
  });
  if (!membership) return { ok: false, message: "That client is not on this project." };

  await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  return { ok: true, message: `Password updated for ${membership.user.email}.` };
}

// Builder adds ANOTHER client login to this project (e.g. a second owner, or the
// architect). Multiple CLIENT members per project are fully supported. Creates a
// new CLIENT user or, if the email already exists as a client, updates their
// password and grants access. Never touches a J Group staff account.
export async function addClientToProject(projectId: string, formData: FormData): Promise<SimpleResult> {
  const actor = await assertProjectAccess(projectId);
  if (actor.role !== Role.BUILDER) throw new AccessError("Only builders manage client access");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").trim();
  if (!name) return { ok: false, message: "Name is required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Enter a valid email." };
  if (password.length < 8) return { ok: false, message: "Password must be at least 8 characters." };

  const existing = await db.user.findUnique({ where: { email } });
  let userId: string;
  if (!existing) {
    const u = await db.user.create({
      data: { email, name, role: Role.CLIENT, passwordHash: await bcrypt.hash(password, 10) },
    });
    userId = u.id;
  } else if (existing.role === Role.CLIENT) {
    await db.user.update({ where: { id: existing.id }, data: { passwordHash: await bcrypt.hash(password, 10), name } });
    userId = existing.id;
  } else {
    return { ok: false, message: "That email belongs to a J Group staff account." };
  }

  await db.projectMembership.upsert({
    where: { userId_projectId: { userId, projectId } },
    create: { userId, projectId, role: Role.CLIENT },
    update: {},
  });
  revalidatePath(`/projects/${projectId}/settings`);
  return { ok: true, message: `${email} can now sign in to this project.` };
}

// Builder revokes a client's access to THIS project (removes the membership;
// the user account itself is kept in case they're on other projects).
export async function removeClientFromProject(projectId: string, userId: string): Promise<SimpleResult> {
  const actor = await assertProjectAccess(projectId);
  if (actor.role !== Role.BUILDER) throw new AccessError("Only builders manage client access");
  await db.projectMembership.deleteMany({ where: { projectId, userId, user: { role: Role.CLIENT } } });
  revalidatePath(`/projects/${projectId}/settings`);
  return { ok: true, message: "Access removed." };
}

const ORDER: ProjectPhase[] = [ProjectPhase.BUILD, ProjectPhase.HANDOVER, ProjectPhase.MAINTENANCE];

// Builder advances (or sets) the project's lifecycle phase. Data in every module
// stays accessible regardless of phase — this only changes which suite is primary.
export async function setPhase(projectId: string, phase: ProjectPhase) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders change the project phase");
  if (!ORDER.includes(phase)) throw new Error("Invalid phase");
  await db.project.update({ where: { id: projectId }, data: { phase } });
  revalidatePath(`/projects/${projectId}`, "layout");
}
