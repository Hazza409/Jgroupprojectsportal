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

const ORDER: ProjectPhase[] = [ProjectPhase.BUILD, ProjectPhase.HANDOVER, ProjectPhase.MAINTENANCE];

// Builder advances (or sets) the project's lifecycle phase. Data in every module
// stays accessible regardless of phase — this only changes which suite is primary.
export async function setPhase(projectId: string, phase: ProjectPhase) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== "BUILDER") throw new AccessError("Only builders change the project phase");
  if (!ORDER.includes(phase)) throw new Error("Invalid phase");
  await db.project.update({ where: { id: projectId }, data: { phase } });
  revalidatePath(`/projects/${projectId}`, "layout");
}
