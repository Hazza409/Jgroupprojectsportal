"use server";

import { revalidatePath } from "next/cache";
import { Role, DesignDocKind } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";

// Builder uploads architectural / interior drawings (PDF or image).
export async function uploadDocument(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders upload drawings");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("No file uploaded");
  const title = String(formData.get("title") ?? "").trim() || file.name;
  const kindRaw = String(formData.get("kind") ?? "ARCHITECTURAL");
  const kind = (Object.values(DesignDocKind) as string[]).includes(kindRaw)
    ? (kindRaw as DesignDocKind)
    : DesignDocKind.ARCHITECTURAL;

  const buf = Buffer.from(await file.arrayBuffer());
  const store = await storage();
  const key = buildKey({ projectId, category: "docs", originalName: `${Date.now()}-${file.name}` });
  await store.put({ key, body: buf, contentType: file.type || "application/octet-stream" });

  await db.designDocument.create({
    data: { projectId, kind, title, fileKey: key, originalName: file.name, uploadedById: user.id },
  });
  revalidatePath(`/projects/${projectId}/documents`);
}

export async function deleteDocument(projectId: string, docId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders delete drawings");
  const doc = await db.designDocument.findFirst({ where: { id: docId, projectId } });
  if (!doc) return;
  const store = await storage();
  await store.delete(doc.fileKey);
  await db.designDocument.delete({ where: { id: doc.id } });
  revalidatePath(`/projects/${projectId}/documents`);
}
