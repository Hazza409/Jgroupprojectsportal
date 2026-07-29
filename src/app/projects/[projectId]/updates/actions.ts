"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
import { notifyProject } from "@/lib/email";
import { getCompany, companyShortName } from "@/lib/company";
import { recordDecision, hasAcknowledged, ACKNOWLEDGEMENT_STATEMENT } from "@/lib/audit";
import { applyHouseStyle, houseStyleField } from "@/lib/houseStyle";
import { DecisionAction, DecisionSubject } from "@prisma/client";

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/updates`);
}

async function builderOnly(projectId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders post updates");
  return user;
}

// Builder posts a fortnightly summary entry. Structured sections (trades on
// site / works completed / upcoming / delays) are all optional; at least one of
// them or the general notes must be filled so an update is never empty.
export async function createUpdate(projectId: string, formData: FormData) {
  const user = await builderOnly(projectId);
  const title = String(formData.get("title") ?? "").trim();
  const str = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v.length ? v : null;
  };
  // House style applies to everything client-facing: full trade names, proper
  // sentence case (Jake §6). Site shorthand is fine to type — it's normalised
  // here so what publishes reads under the J Group name.
  const tradesOnSite = houseStyleField(str("tradesOnSite")).value;
  const worksCompleted = houseStyleField(str("worksCompleted")).value;
  const upcomingWorks = houseStyleField(str("upcomingWorks")).value;
  const decisionsNeeded = houseStyleField(str("decisionsNeeded")).value;
  const delaysNotes = houseStyleField(str("delaysNotes")).value;
  const body = houseStyleField(String(formData.get("body") ?? "")).value ?? "";
  if (!title) throw new Error("Title is required");
  if (!tradesOnSite && !worksCompleted && !upcomingWorks && !decisionsNeeded && !delaysNotes && !body) {
    throw new Error("Fill in at least one section of the summary");
  }
  await db.projectUpdate.create({
    data: {
      projectId,
      title: applyHouseStyle(title).text,
      tradesOnSite,
      worksCompleted,
      upcomingWorks,
      decisionsNeeded,
      delaysNotes,
      body,
      createdById: user.id,
    },
  });

  // Tell the client(s) + PM there's a new site update to read.
  const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true } });
  await notifyProject(
    projectId,
    `New site update — ${project?.name ?? "your project"}`,
    [
      `${companyShortName(await getCompany())} has posted a new site update on ${project?.name ?? "your project"}.`,
      `${title}`,
      `Sign in to read the full summary and photos.`,
    ],
    { excludeUserId: user.id },
  );
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

/**
 * Client acknowledges a fortnightly summary (Jake §2). Receipt, NOT approval —
 * a client who has acknowledged every statement cannot later claim they didn't
 * see the budget move. Recorded once per user, immutably.
 */
export async function acknowledgeUpdate(projectId: string, updateId: string) {
  const user = await assertProjectAccess(projectId);
  const update = await db.projectUpdate.findFirst({
    where: { id: updateId, projectId },
    select: { id: true, title: true },
  });
  if (!update) throw new Error("Update not found");
  if (await hasAcknowledged(DecisionSubject.UPDATE, updateId, user.id)) return; // once only

  await recordDecision({
    projectId,
    subjectType: DecisionSubject.UPDATE,
    subjectId: updateId,
    subjectRef: "Fortnightly summary",
    subjectTitle: update.title,
    action: DecisionAction.ACKNOWLEDGED,
    actor: user,
    detail: ACKNOWLEDGEMENT_STATEMENT,
  });
  refresh(projectId);
}
