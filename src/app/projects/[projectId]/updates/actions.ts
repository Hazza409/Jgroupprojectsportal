"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/updates`);
}

async function builderOnly(projectId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders post updates");
  return user;
}

// Builder posts a fortnightly summary entry.
export async function createUpdate(projectId: string, formData: FormData) {
  const user = await builderOnly(projectId);
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) throw new Error("Title and summary are required");
  await db.projectUpdate.create({ data: { projectId, title, body, createdById: user.id } });
  refresh(projectId);
}

// Builder attaches photos to a specific update.
export async function addUpdatePhotos(projectId: string, updateId: string, formData: FormData) {
  await builderOnly(projectId);
  const update = await db.projectUpdate.findFirst({ where: { id: updateId, projectId }, select: { id: true } });
  if (!update) throw new Error("Update not found");

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) throw new Error("No files uploaded");
  const store = await storage();
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const key = buildKey({ projectId, category: "updates", originalName: `${Date.now()}-${file.name}` });
    await store.put({ key, body: buf, contentType: file.type || "image/jpeg" });
    await db.updatePhoto.create({ data: { updateId, fileKey: key, originalName: file.name } });
  }
  refresh(projectId);
}

export async function deleteUpdatePhoto(projectId: string, photoId: string) {
  await builderOnly(projectId);
  const photo = await db.updatePhoto.findFirst({ where: { id: photoId, update: { projectId } } });
  if (!photo) return;
  await (await storage()).delete(photo.fileKey).catch(() => {});
  await db.updatePhoto.delete({ where: { id: photo.id } });
  refresh(projectId);
}

export async function deleteUpdate(projectId: string, updateId: string) {
  await builderOnly(projectId);
  const update = await db.projectUpdate.findFirst({ where: { id: updateId, projectId }, include: { photos: true } });
  if (!update) return;
  const store = await storage();
  await Promise.all(update.photos.map((p) => store.delete(p.fileKey).catch(() => {})));
  await db.projectUpdate.delete({ where: { id: update.id } }); // cascades UpdatePhoto rows
  refresh(projectId);
}
