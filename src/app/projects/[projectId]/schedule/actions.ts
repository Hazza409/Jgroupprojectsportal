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
 * Bulk-edit the programme (Jake: updated fortnightly).
 *
 * The form posts one field per task per column — `start_<id>`, `finish_<id>`,
 * `days_<id>`, `pct_<id>` — so a whole fortnight's update saves in one action
 * rather than a click per row. Ids are validated against the project and never
 * trusted from the form; only genuinely changed rows are written.
 *
 * Days is derived from the dates when left blank, because a duration left over
 * from the old dates would otherwise silently contradict them. A value typed in
 * explicitly always wins.
 */
export async function updateScheduleProgress(projectId: string, formData: FormData): Promise<ImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) return { ok: false, message: "Builder access required." };

  const existing = await db.scheduleItem.findMany({
    where: { projectId },
    select: { id: true, percentComplete: true, durationDays: true, startDate: true, endDate: true },
  });

  const parseDate = (v: FormDataEntryValue | null): Date | null => {
    const t = String(v ?? "").trim();
    if (!t) return null;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const sameDay = (a: Date | null, b: Date | null) =>
    (a === null && b === null) || (a !== null && b !== null && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10));

  let changed = 0;
  const problems: string[] = [];

  for (const row of existing) {
    const hasAny = ["start_", "finish_", "days_", "pct_"].some((p) => formData.has(p + row.id));
    if (!hasAny) continue;

    const data: { percentComplete?: number; durationDays?: number; startDate?: Date | null; endDate?: Date | null } = {};

    // Progress
    const pctRaw = String(formData.get(`pct_${row.id}`) ?? "").trim();
    if (pctRaw !== "") {
      const n = Number(pctRaw);
      if (Number.isFinite(n)) {
        const pct = Math.max(0, Math.min(100, Math.round(n)));
        if (pct !== row.percentComplete) data.percentComplete = pct;
      }
    }

    // Dates
    const start = formData.has(`start_${row.id}`) ? parseDate(formData.get(`start_${row.id}`)) : row.startDate;
    const finish = formData.has(`finish_${row.id}`) ? parseDate(formData.get(`finish_${row.id}`)) : row.endDate;
    if (start && finish && finish < start) {
      problems.push("A finish date was before its start date and was not saved.");
      continue;
    }
    if (formData.has(`start_${row.id}`) && !sameDay(start, row.startDate)) data.startDate = start;
    if (formData.has(`finish_${row.id}`) && !sameDay(finish, row.endDate)) data.endDate = finish;

    // Days — explicit value wins; blank re-derives from the dates.
    const daysRaw = String(formData.get(`days_${row.id}`) ?? "").trim();
    if (daysRaw !== "") {
      const n = Number(daysRaw);
      if (Number.isFinite(n) && n >= 0) {
        const days = Math.round(n);
        if (days !== row.durationDays) data.durationDays = days;
      }
    } else if (start && finish) {
      const derived = Math.max(0, Math.round((finish.getTime() - start.getTime()) / 86_400_000));
      if (derived !== row.durationDays) data.durationDays = derived;
    }

    if (Object.keys(data).length > 0) {
      await db.scheduleItem.update({ where: { id: row.id }, data });
      changed++;
    }
  }

  revalidatePath(`/projects/${projectId}/schedule`);
  revalidatePath(`/projects/${projectId}`);
  const note = problems.length ? ` ${[...new Set(problems)].join(" ")}` : "";
  return {
    ok: problems.length === 0,
    message: (changed === 0 ? "No changes to save." : `Updated ${changed} task${changed === 1 ? "" : "s"}.`) + note,
  };
}
