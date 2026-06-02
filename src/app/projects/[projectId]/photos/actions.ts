"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";

// Builder uploads site photos (fortnightly). Multiple files per submit, into an
// optional folder/album for grouping for the client.
export async function uploadPhotos(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders upload photos");

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) throw new Error("No files uploaded");
  const caption = String(formData.get("caption") ?? "") || null;
  // Validate the folder belongs to this project (scoping).
  const folderIdRaw = String(formData.get("folderId") ?? "");
  let folderId: string | null = null;
  if (folderIdRaw) {
    const folder = await db.photoFolder.findFirst({ where: { id: folderIdRaw, projectId }, select: { id: true } });
    folderId = folder?.id ?? null;
  }

  const store = await storage();
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const key = buildKey({ projectId, category: "photos", originalName: `${Date.now()}-${file.name}` });
    await store.put({ key, body: buf, contentType: file.type || "image/jpeg" });
    await db.photo.create({
      data: { projectId, folderId, fileKey: key, originalName: file.name, caption, uploadedById: user.id },
    });
  }
  revalidatePath(`/projects/${projectId}/photos`);
}

// Builder creates a photo folder (album) to group photos for the client.
export async function createPhotoFolder(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders manage folders");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const last = await db.photoFolder.findFirst({ where: { projectId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  await db.photoFolder.create({ data: { projectId, name, sortOrder: (last?.sortOrder ?? 0) + 1 } });
  revalidatePath(`/projects/${projectId}/photos`);
}

// Delete a folder. Photos are kept (un-foldered) via onDelete: SetNull.
export async function deletePhotoFolder(projectId: string, folderId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders manage folders");
  await db.photoFolder.deleteMany({ where: { id: folderId, projectId } });
  revalidatePath(`/projects/${projectId}/photos`);
}

export async function deletePhoto(projectId: string, photoId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders delete photos");
  const photo = await db.photo.findFirst({ where: { id: photoId, projectId } });
  if (!photo) return;
  const store = await storage();
  await store.delete(photo.fileKey);
  await db.photo.delete({ where: { id: photo.id } });
  revalidatePath(`/projects/${projectId}/photos`);
}
