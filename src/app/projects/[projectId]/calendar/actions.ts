"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { notifyBuilders, notifyProject } from "@/lib/email";
import { getCompany, companyShortName } from "@/lib/company";

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

  const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true } });
  const company = await getCompany();
  if (user.role === Role.CLIENT) {
    // Client requested a meeting → notify the J Group team.
    await notifyBuilders(
      `Meeting requested — ${project?.name ?? "project"}`,
      [
        `${user.name} (client) requested a site meeting on ${project?.name ?? "their project"}.`,
        `Title: ${title}`,
        `When: ${fmtDateTime(startsAt)} – ${fmtDateTime(endsAt)}`,
        location ? `Where: ${location}` : "",
        `Open the ${companyShortName(company)} dashboard calendar to confirm or reschedule.`,
      ].filter(Boolean),
    );
  } else {
    // Builder scheduled a meeting → notify the client(s) + PM, who can accept it.
    await notifyProject(
      projectId,
      `Site meeting scheduled — ${project?.name ?? "your project"}`,
      [
        `${companyShortName(company)} has scheduled a site meeting on ${project?.name ?? "your project"}.`,
        `Title: ${title}`,
        `When: ${fmtDateTime(startsAt)} – ${fmtDateTime(endsAt)}`,
        location ? `Where: ${location}` : "",
        `Sign in to the calendar to accept.`,
      ].filter(Boolean),
      { excludeUserId: user.id },
    );
  }

  refresh(projectId);
}

// A project member (client/architect/PM) accepts or declines a site meeting.
export async function respondToEvent(projectId: string, eventId: string, accept: boolean) {
  const user = await assertProjectAccess(projectId);
  const event = await db.calendarEvent.findFirst({
    where: { id: eventId, projectId },
    select: { id: true, title: true },
  });
  if (!event) throw new Error("Meeting not found");

  await db.calendarEventResponse.upsert({
    where: { eventId_userId: { eventId, userId: user.id } },
    create: { eventId, userId: user.id, status: accept ? "ACCEPTED" : "DECLINED" },
    update: { status: accept ? "ACCEPTED" : "DECLINED" },
  });

  // Let the J Group team know who's coming.
  const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true } });
  await notifyBuilders(`Meeting ${accept ? "accepted" : "declined"} — ${project?.name ?? "project"}`, [
    `${user.name} (${user.role.toLowerCase()}) ${accept ? "accepted" : "declined"} the site meeting "${event.title}" on ${project?.name ?? "the project"}.`,
  ]);
  refresh(projectId);
}

export async function deleteEvent(projectId: string, eventId: string) {
  await assertProjectAccess(projectId);
  // Scope the delete by projectId so an id from another project can't be removed.
  await db.calendarEvent.deleteMany({ where: { id: eventId, projectId } });
  refresh(projectId);
}
