"use server";

import { revalidatePath } from "next/cache";
import { Role, RfiStatus, RfiKind } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
import { notifyProject } from "@/lib/email";
import { getCompany, companyShortName } from "@/lib/company";

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/rfis`);
}

// Accept images + PDFs only (drawings, photos, spec pages).
const ALLOWED = /^(image\/|application\/pdf$)/;

// Save uploaded files against an RFI. Keys live under projects/{projectId}/rfis
// so the /api/files route authorises them by project scope.
async function saveRfiFiles(projectId: string, rfiId: string, files: File[]) {
  if (files.length === 0) return;
  const store = await storage();
  for (const file of files) {
    if (file.size === 0 || !ALLOWED.test(file.type)) continue;
    const buf = Buffer.from(await file.arrayBuffer());
    const key = buildKey({ projectId, category: "rfis", originalName: `${Date.now()}-${file.name}` });
    await store.put({ key, body: buf, contentType: file.type || "application/octet-stream" });
    await db.rfiAttachment.create({ data: { rfiId, fileKey: key, originalName: file.name, contentType: file.type || null } });
  }
}

// Builder raises a question OR a decision/selection request to the client.
export async function createRfi(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders raise questions");

  const subject = String(formData.get("subject") ?? "").trim();
  const question = String(formData.get("question") ?? "").trim();
  if (!subject || !question) throw new Error("Subject and details are required");
  const kind = String(formData.get("kind") ?? "") === "DECISION" ? RfiKind.DECISION : RfiKind.QUESTION;
  const optionsProvided = kind === RfiKind.DECISION ? (String(formData.get("optionsProvided") ?? "").trim() || null) : null;
  const impactIfLate = kind === RfiKind.DECISION ? (String(formData.get("impactIfLate") ?? "").trim() || null) : null;
  const dueRaw = String(formData.get("dueDate") ?? "");

  const last = await db.rfi.findFirst({ where: { projectId }, orderBy: { number: "desc" }, select: { number: true } });
  const rfi = await db.rfi.create({
    data: {
      projectId,
      number: (last?.number ?? 0) + 1,
      subject,
      question,
      kind,
      optionsProvided,
      impactIfLate,
      dueDate: dueRaw ? new Date(dueRaw) : null,
      raisedById: user.id,
      status: RfiStatus.OPEN,
    },
    include: { project: { select: { name: true } } },
  });

  // Any files attached at creation.
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  await saveRfiFiles(projectId, rfi.id, files);

  // Tell the client(s) + PM there's a question/decision awaiting their response.
  const noun = kind === RfiKind.DECISION ? "decision" : "question";
  await notifyProject(
    projectId,
    `New ${noun} — ${rfi.project.name}`,
    [
      `${companyShortName(await getCompany())} has raised a ${noun} (#${rfi.number}) on ${rfi.project.name}.`,
      `${subject}`,
      rfi.dueDate
        ? `Response needed by ${new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(rfi.dueDate)}.`
        : `Please sign in to respond.`,
    ],
    { excludeUserId: user.id },
  );
  refresh(projectId);
}

// Builder attaches supporting files (drawings/photos/PDFs) to an existing item.
export async function addRfiAttachments(projectId: string, rfiId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders attach files");
  const rfi = await db.rfi.findFirst({ where: { id: rfiId, projectId }, select: { id: true } });
  if (!rfi) throw new Error("Not found");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) throw new Error("No files uploaded");
  await saveRfiFiles(projectId, rfiId, files);
  refresh(projectId);
}

export async function deleteRfiAttachment(projectId: string, attachmentId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders remove files");
  const att = await db.rfiAttachment.findFirst({ where: { id: attachmentId, rfi: { projectId } } });
  if (!att) return;
  await (await storage()).delete(att.fileKey).catch(() => {});
  await db.rfiAttachment.delete({ where: { id: att.id } });
  refresh(projectId);
}

// Client answers an open RFI. (Builders raise/close, not answer.)
export async function answerRfi(projectId: string, rfiId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role === Role.BUILDER) throw new AccessError("RFIs are answered by the client");
  const answer = String(formData.get("answer") ?? "").trim();
  if (!answer) throw new Error("Answer is required");
  await db.rfi.updateMany({
    where: { id: rfiId, projectId, status: RfiStatus.OPEN },
    data: { answer, status: RfiStatus.ANSWERED, answeredById: user.id, answeredAt: new Date() },
  });
  refresh(projectId);
}

// Builder closes an answered RFI.
export async function closeRfi(projectId: string, rfiId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders close RFIs");
  await db.rfi.updateMany({ where: { id: rfiId, projectId }, data: { status: RfiStatus.CLOSED } });
  refresh(projectId);
}

export async function deleteRfi(projectId: string, rfiId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders delete RFIs");
  await db.rfi.deleteMany({ where: { id: rfiId, projectId } });
  refresh(projectId);
}
