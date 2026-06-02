"use server";

import { revalidatePath } from "next/cache";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/calendar`);
}

// Site meetings — both builder and client of the project may add/remove events.
export async function createEvent(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);

  const title = String(formData.get("title") ?? "").trim();
  const startsAt = new Date(String(formData.get("startsAt") ?? ""));
  if (!title || Number.isNaN(startsAt.getTime())) throw new Error("Title and start time required");

  const endRaw = String(formData.get("endsAt") ?? "");
  const endsAt = endRaw ? new Date(endRaw) : new Date(startsAt.getTime() + 60 * 60 * 1000);

  await db.calendarEvent.create({
    data: {
      projectId,
      title,
      location: String(formData.get("location") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
      startsAt,
      endsAt,
      createdById: user.id,
    },
  });
  refresh(projectId);
}

export async function deleteEvent(projectId: string, eventId: string) {
  await assertProjectAccess(projectId);
  // Scope the delete by projectId so an id from another project can't be removed.
  await db.calendarEvent.deleteMany({ where: { id: eventId, projectId } });
  refresh(projectId);
}
