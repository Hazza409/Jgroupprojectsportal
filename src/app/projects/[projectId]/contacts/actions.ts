"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/contacts`);
}

async function builderOnly(projectId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders manage contacts");
  return user;
}

// Builder adds a J Group contact the client can reach for this project.
export async function createContact(projectId: string, formData: FormData) {
  await builderOnly(projectId);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");
  const role = String(formData.get("role") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;

  const last = await db.projectContact.findFirst({
    where: { projectId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  await db.projectContact.create({
    data: { projectId, name, role, phone, email, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  refresh(projectId);
}

export async function deleteContact(projectId: string, contactId: string) {
  await builderOnly(projectId);
  await db.projectContact.deleteMany({ where: { id: contactId, projectId } });
  refresh(projectId);
}
