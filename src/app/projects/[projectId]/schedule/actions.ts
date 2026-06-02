"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
import { parseScheduleBuffer } from "@/lib/excel/parseSchedule";

export interface ImportResult {
  ok: boolean;
  message: string;
  warnings?: string[];
}

// Import a schedule xlsx → ScheduleItem rows. Each import replaces the prior
// schedule (fortnightly update), keeping the source file for audit.
export async function importSchedule(projectId: string, formData: FormData): Promise<ImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders import schedules");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "No file uploaded." };
  if (!/\.xlsx?$/i.test(file.name)) return { ok: false, message: "Please upload an .xlsx or .xls file." };

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseScheduleBuffer(buf);
  if (parsed.items.length === 0) {
    return { ok: false, message: "No rows parsed.", warnings: parsed.warnings };
  }

  const store = await storage();
  const key = buildKey({ projectId, category: "schedules", originalName: `${Date.now()}-${file.name}` });
  await store.put({ key, body: buf, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  await db.$transaction(async (tx) => {
    // Fortnightly update = fresh snapshot. Replace existing items.
    await tx.scheduleItem.deleteMany({ where: { projectId } });
    const imp = await tx.scheduleImport.create({
      data: { projectId, sourceKey: key, originalName: file.name, rowCount: parsed.items.length, importedById: user.id },
    });
    await tx.scheduleItem.createMany({
      data: parsed.items.map((i) => ({
        projectId,
        importId: imp.id,
        taskName: i.taskName,
        startDate: i.startDate,
        endDate: i.endDate,
        percentComplete: i.percentComplete,
        sortOrder: i.sortOrder,
      })),
    });
  });

  revalidatePath(`/projects/${projectId}/schedule`);
  return { ok: true, message: `Imported ${parsed.items.length} schedule item(s).`, warnings: parsed.warnings };
}
