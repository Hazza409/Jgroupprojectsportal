"use server";

import { revalidatePath } from "next/cache";
import { ProjectPhase } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";

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
