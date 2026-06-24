"use server";

import { revalidatePath } from "next/cache";
import { Role, RfiStatus } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/email";

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/rfis`);
}

// Builder raises a design question (RFI) to the client.
export async function createRfi(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders raise RFIs");

  const subject = String(formData.get("subject") ?? "").trim();
  const question = String(formData.get("question") ?? "").trim();
  if (!subject || !question) throw new Error("Subject and question are required");
  const dueRaw = String(formData.get("dueDate") ?? "");

  const last = await db.rfi.findFirst({ where: { projectId }, orderBy: { number: "desc" }, select: { number: true } });
  const rfi = await db.rfi.create({
    data: {
      projectId,
      number: (last?.number ?? 0) + 1,
      subject,
      question,
      dueDate: dueRaw ? new Date(dueRaw) : null,
      raisedById: user.id,
      status: RfiStatus.OPEN,
    },
    include: { project: { select: { name: true } } },
  });

  // Tell the client(s) + PM there's a design question awaiting their response.
  await notifyProject(
    projectId,
    `New RFI — ${rfi.project.name}`,
    [
      `J Group has raised a design question (RFI #${rfi.number}) on ${rfi.project.name}.`,
      `${subject}`,
      rfi.dueDate
        ? `Response needed by ${new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(rfi.dueDate)}.`
        : `Please sign in to respond.`,
    ],
    { excludeUserId: user.id },
  );
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
