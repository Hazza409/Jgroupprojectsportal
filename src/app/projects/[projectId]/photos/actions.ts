"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";

// Builder uploads site photos (fortnightly). Multiple files per submit.
export async function uploadPhotos(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders upload photos");

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) throw new Error("No files uploaded");
  const caption = String(formData.get("caption") ?? "") || null;

  const store = await storage();
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const key = buildKey({ projectId, category: "photos", originalName: `${Date.now()}-${file.name}` });
    await store.put({ key, body: buf, contentType: file.type || "image/jpeg" });
    await db.photo.create({
      data: { projectId, fileKey: key, originalName: file.name, caption, uploadedById: user.id },
    });
  }
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
