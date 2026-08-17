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
  if (!/\.(xlsx?|csv)$/i.test(file.name)) return { ok: false, message: "Please upload an .xlsx, .xls or .csv file." };

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
        group: i.group,
        taskName: i.taskName,
        startDate: i.startDate,
        endDate: i.endDate,
        durationDays: i.durationDays,
        percentComplete: i.percentComplete,
        sortOrder: i.sortOrder,
      })),
    });
  });

  revalidatePath(`/projects/${projectId}/schedule`);
  return { ok: true, message: `Imported ${parsed.items.length} schedule item(s).`, warnings: parsed.warnings };
}

// Manually add a single schedule task (no Excel needed).
export async function addScheduleTask(projectId: string, formData: FormData): Promise<ImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders edit the schedule");

  const taskName = String(formData.get("taskName") ?? "").trim();
  if (!taskName) return { ok: false, message: "Task name is required." };

  const group = String(formData.get("group") ?? "").trim() || null;
  const startRaw = String(formData.get("startDate") ?? "");
  const endRaw = String(formData.get("endDate") ?? "");
  const startDate = startRaw ? new Date(startRaw) : null;
  const endDate = endRaw ? new Date(endRaw) : null;
  let pct = Number(formData.get("percentComplete") ?? 0) || 0;
  pct = Math.max(0, Math.min(100, pct));
  const durationDays =
    startDate && endDate ? Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000)) : 0;

  const last = await db.scheduleItem.findFirst({
    where: { projectId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  await db.scheduleItem.create({
    data: {
      projectId,
      group,
      taskName,
      startDate,
      endDate,
      durationDays,
      percentComplete: pct,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });

  revalidatePath(`/projects/${projectId}/schedule`);
  return { ok: true, message: `Added "${taskName}".` };
}

export async function deleteScheduleTask(projectId: string, taskId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders edit the schedule");
  await db.scheduleItem.deleteMany({ where: { id: taskId, projectId } });
  revalidatePath(`/projects/${projectId}/schedule`);
}

/**
 * Bulk-update task progress (Jake: the programme is updated fortnightly).
 *
 * The form posts one `pct_<taskId>` per row so a whole fortnight's update saves
 * in a single action rather than a click per task. Ids are validated against
 * the project — never trusted from the form — and values are clamped to 0–100.
 * Only genuinely changed rows are written, so a no-op save touches nothing.
 */
export async function updateScheduleProgress(projectId: string, formData: FormData): Promise<ImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) return { ok: false, message: "Builder access required." };

  const existing = await db.scheduleItem.findMany({
    where: { projectId },
    select: { id: true, percentComplete: true },
  });
  const current = new Map(existing.map((t) => [t.id, t.percentComplete]));

  let changed = 0;
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("pct_")) continue;
    const id = key.slice(4);
    if (!current.has(id)) continue; // not on this project — ignore silently

    const text = String(raw).trim();
    if (text === "") continue;
    const n = Number(text);
    if (!Number.isFinite(n)) continue;
    const pct = Math.max(0, Math.min(100, Math.round(n)));

    if (pct !== current.get(id)) {
      await db.scheduleItem.update({ where: { id }, data: { percentComplete: pct } });
      changed++;
    }
  }

  revalidatePath(`/projects/${projectId}/schedule`);
  revalidatePath(`/projects/${projectId}`);
  return {
    ok: true,
    message: changed === 0 ? "No changes to save." : `Updated progress on ${changed} task${changed === 1 ? "" : "s"}.`,
  };
}
