"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { notifyBuilders } from "@/lib/email";

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/calendar`);
}

const fmtDateTime = (d: Date) =>
  new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(d);

// Site meetings — both builder and client of the project may add/remove events.
export async function createEvent(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);

  const title = String(formData.get("title") ?? "").trim();
  const startsAt = new Date(String(formData.get("startsAt") ?? ""));
  if (!title || Number.isNaN(startsAt.getTime())) throw new Error("Title and start time required");

  const endRaw = String(formData.get("endsAt") ?? "");
  const endsAt = endRaw ? new Date(endRaw) : new Date(startsAt.getTime() + 60 * 60 * 1000);

  const location = String(formData.get("location") ?? "") || null;
  await db.calendarEvent.create({
    data: {
      projectId,
      title,
      location,
      notes: String(formData.get("notes") ?? "") || null,
      startsAt,
      endsAt,
      createdById: user.id,
    },
  });

  // Notify the J Group team when the CLIENT requests a meeting.
  if (user.role === Role.CLIENT) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true } });
    await notifyBuilders(
      `Meeting requested — ${project?.name ?? "project"}`,
      [
        `${user.name} (client) requested a site meeting on ${project?.name ?? "their project"}.`,
        `Title: ${title}`,
        `When: ${fmtDateTime(startsAt)} – ${fmtDateTime(endsAt)}`,
        location ? `Where: ${location}` : "",
        `Open the J Group dashboard calendar to confirm or reschedule.`,
      ].filter(Boolean),
    );
  }

  refresh(projectId);
}

export async function deleteEvent(projectId: string, eventId: string) {
  await assertProjectAccess(projectId);
  // Scope the delete by projectId so an id from another project can't be removed.
  await db.calendarEvent.deleteMany({ where: { id: eventId, projectId } });
  refresh(projectId);
}
