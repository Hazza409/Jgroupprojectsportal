"use server";

import { revalidatePath } from "next/cache";
import { HandoverDocKind, Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";

async function builderOnly(projectId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Builder action only");
  return user;
}

// Upload a handover document into a given store (Register / O&M / J Group / Warranty).
export async function uploadHandoverDoc(projectId: string, kind: HandoverDocKind, formData: FormData) {
  const user = await builderOnly(projectId);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("No file uploaded");
  const title = String(formData.get("title") ?? "").trim() || file.name;

  const buf = Buffer.from(await file.arrayBuffer());
  const store = await storage();
  const key = buildKey({ projectId, category: "handover", originalName: `${Date.now()}-${file.name}` });
  await store.put({ key, body: buf, contentType: file.type || "application/octet-stream" });

  await db.handoverDocument.create({
    data: { projectId, kind, title, fileKey: key, originalName: file.name, uploadedById: user.id },
  });
  revalidatePath(`/projects/${projectId}/handover`, "layout");
}

export async function deleteHandoverDoc(projectId: string, docId: string) {
  await builderOnly(projectId);
  const doc = await db.handoverDocument.findFirst({ where: { id: docId, projectId } });
  if (!doc) return;
  await (await storage()).delete(doc.fileKey);
  await db.handoverDocument.delete({ where: { id: doc.id } });
  revalidatePath(`/projects/${projectId}/handover`, "layout");
}

// Structured warranty record (+ optional certificate file).
export async function createWarranty(projectId: string, formData: FormData) {
  const user = await builderOnly(projectId);
  const item = String(formData.get("item") ?? "").trim();
  const issuer = String(formData.get("issuer") ?? "").trim();
  if (!item || !issuer) throw new Error("Item and issuer are required");
  const expiryRaw = String(formData.get("expiryDate") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  let fileKey: string | null = null;
  let originalName: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const buf = Buffer.from(await file.arrayBuffer());
    fileKey = buildKey({ projectId, category: "handover", originalName: `${Date.now()}-${file.name}` });
    await (await storage()).put({ key: fileKey, body: buf, contentType: file.type || "application/octet-stream" });
    originalName = file.name;
  }
  // Keep `user` referenced for parity with other builder actions / future audit.
  void user;

  await db.warranty.create({
    data: { projectId, item, issuer, expiryDate: expiryRaw ? new Date(expiryRaw) : null, notes, fileKey, originalName },
  });
  revalidatePath(`/projects/${projectId}/handover/warranties`);
}

export async function deleteWarranty(projectId: string, id: string) {
  await builderOnly(projectId);
  const w = await db.warranty.findFirst({ where: { id, projectId } });
  if (!w) return;
  if (w.fileKey) await (await storage()).delete(w.fileKey).catch(() => {});
  await db.warranty.delete({ where: { id: w.id } });
  revalidatePath(`/projects/${projectId}/handover/warranties`);
}
