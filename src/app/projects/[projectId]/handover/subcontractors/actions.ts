"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
import { parseSubcontractorsBuffer } from "@/lib/excel/parseSubcontractors";

export interface ImportResult {
  ok: boolean;
  message: string;
  rowCount?: number;
  warnings?: string[];
}

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/handover/subcontractors`);
}

async function builderOnly(projectId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders manage subcontractors");
  return user;
}

// Bulk-import the subcontractor directory from .xlsx/.csv. Replace (default)
// clears the existing list first so a re-upload resets it.
export async function importSubcontractors(projectId: string, formData: FormData): Promise<ImportResult> {
  await builderOnly(projectId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "No file uploaded." };
  if (!/\.(xlsx?|csv)$/i.test(file.name)) {
    return { ok: false, message: "Please upload an .xlsx, .xls or .csv file." };
  }
  const replace = !!formData.get("replace");

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseSubcontractorsBuffer(buf);
  if (parsed.rows.length === 0) {
    return { ok: false, message: "No subcontractors parsed.", warnings: parsed.warnings };
  }

  // Keep the source file (audit) before touching the DB.
  const store = await storage();
  const key = buildKey({ projectId, category: "subcontractors", originalName: `${Date.now()}-${file.name}` });
  await store.put({
    key,
    body: buf,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  await db.$transaction(async (tx) => {
    if (replace) await tx.subcontractorContact.deleteMany({ where: { projectId } });
    const last = await tx.subcontractorContact.findFirst({
      where: { projectId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    let order = (last?.sortOrder ?? 0) + 1;
    await tx.subcontractorContact.createMany({
      data: parsed.rows.map((s) => ({
        projectId,
        trade: s.trade,
        company: s.company,
        contactName: s.contactName,
        phone: s.phone,
        email: s.email,
        sortOrder: order++,
      })),
    });
  });

  refresh(projectId);
  return {
    ok: true,
    message: `${replace ? "Replaced — " : "Imported "}${parsed.rows.length} subcontractor(s).`,
    rowCount: parsed.rows.length,
    warnings: parsed.warnings,
  };
}

export async function createSubcontractor(projectId: string, formData: FormData) {
  await builderOnly(projectId);
  const company = String(formData.get("company") ?? "").trim() || null;
  const contactName = String(formData.get("contactName") ?? "").trim() || null;
  if (!company && !contactName) throw new Error("Add a company or a contact name");
  const trade = String(formData.get("trade") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;

  const last = await db.subcontractorContact.findFirst({
    where: { projectId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  await db.subcontractorContact.create({
    data: { projectId, company, contactName, trade, phone, email, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  refresh(projectId);
}

export async function deleteSubcontractor(projectId: string, id: string) {
  await builderOnly(projectId);
  await db.subcontractorContact.deleteMany({ where: { id, projectId } });
  refresh(projectId);
}
