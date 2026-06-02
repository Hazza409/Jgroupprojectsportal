"use server";

import { revalidatePath } from "next/cache";
import { Role, CalendarEventKind, ServiceBookingStatus, QuoteRequestStatus } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { dollarsToCents } from "@/lib/money";

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/maintenance`, "layout");
  revalidatePath(`/projects/${projectId}/calendar`);
}

async function builderOnly(projectId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Builder action only");
  return user;
}

// Create a CalendarEvent so a maintenance item / booking shows on the shared calendar.
async function createEvent(projectId: string, kind: CalendarEventKind, title: string, at: Date, createdById: string) {
  const ev = await db.calendarEvent.create({
    data: { projectId, kind, title, startsAt: at, endsAt: new Date(at.getTime() + 60 * 60 * 1000), createdById },
  });
  return ev.id;
}

// ── Maintenance schedule (builder) ──
export async function createMaintenanceItem(projectId: string, formData: FormData) {
  const user = await builderOnly(projectId);
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title required");
  const description = String(formData.get("description") ?? "").trim() || null;
  const frequency = String(formData.get("frequency") ?? "").trim() || null;
  const dueRaw = String(formData.get("nextDueDate") ?? "");
  const nextDueDate = dueRaw ? new Date(dueRaw) : null;

  const calendarEventId = nextDueDate
    ? await createEvent(projectId, CalendarEventKind.MAINTENANCE, `Maintenance: ${title}`, nextDueDate, user.id)
    : null;

  await db.maintenanceScheduleItem.create({
    data: { projectId, title, description, frequency, nextDueDate, calendarEventId },
  });
  refresh(projectId);
}

export async function deleteMaintenanceItem(projectId: string, id: string) {
  await builderOnly(projectId);
  const item = await db.maintenanceScheduleItem.findFirst({ where: { id, projectId } });
  if (!item) return;
  if (item.calendarEventId) await db.calendarEvent.deleteMany({ where: { id: item.calendarEventId, projectId } });
  await db.maintenanceScheduleItem.delete({ where: { id: item.id } });
  refresh(projectId);
}

// ── Service bookings ──
// Client (or builder) raises a booking request.
export async function createBooking(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title required");
  const description = String(formData.get("description") ?? "").trim() || null;
  await db.serviceBooking.create({
    data: { projectId, requestedById: user.id, title, description, status: ServiceBookingStatus.REQUESTED },
  });
  refresh(projectId);
}

// Builder schedules a requested booking → creates a BOOKING calendar event.
export async function scheduleBooking(projectId: string, bookingId: string, formData: FormData) {
  const user = await builderOnly(projectId);
  const whenRaw = String(formData.get("scheduledAt") ?? "");
  if (!whenRaw) throw new Error("Pick a date/time");
  const scheduledAt = new Date(whenRaw);

  const booking = await db.serviceBooking.findFirst({ where: { id: bookingId, projectId } });
  if (!booking) throw new Error("Booking not found");
  // Replace any prior calendar event.
  if (booking.calendarEventId) await db.calendarEvent.deleteMany({ where: { id: booking.calendarEventId, projectId } });
  const calendarEventId = await createEvent(projectId, CalendarEventKind.BOOKING, `Service: ${booking.title}`, scheduledAt, user.id);

  await db.serviceBooking.update({
    where: { id: booking.id },
    data: { status: ServiceBookingStatus.SCHEDULED, scheduledAt, calendarEventId },
  });
  refresh(projectId);
}

export async function setBookingStatus(projectId: string, bookingId: string, status: ServiceBookingStatus) {
  await builderOnly(projectId);
  const booking = await db.serviceBooking.findFirst({ where: { id: bookingId, projectId } });
  if (!booking) return;
  // Remove the calendar event if cancelled.
  if (status === ServiceBookingStatus.CANCELLED && booking.calendarEventId) {
    await db.calendarEvent.deleteMany({ where: { id: booking.calendarEventId, projectId } });
  }
  await db.serviceBooking.update({ where: { id: booking.id }, data: { status } });
  refresh(projectId);
}

// ── Quote requests ──
export async function createQuoteRequest(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title required");
  const description = String(formData.get("description") ?? "").trim() || null;
  await db.quoteRequest.create({
    data: { projectId, requestedById: user.id, title, description, status: QuoteRequestStatus.OPEN },
  });
  refresh(projectId);
}

// Builder responds with a quote (amount + message); client can then accept/decline.
export async function respondQuote(projectId: string, quoteId: string, formData: FormData) {
  await builderOnly(projectId);
  const amount = dollarsToCents(String(formData.get("amount") ?? "0"));
  const response = String(formData.get("response") ?? "").trim() || null;
  await db.quoteRequest.updateMany({
    where: { id: quoteId, projectId },
    data: { quoteAmountCents: amount || null, response, status: QuoteRequestStatus.QUOTED },
  });
  refresh(projectId);
}

export async function decideQuote(projectId: string, quoteId: string, accept: boolean) {
  // Either party on the project may accept/decline a quote.
  await assertProjectAccess(projectId);
  await db.quoteRequest.updateMany({
    where: { id: quoteId, projectId, status: QuoteRequestStatus.QUOTED },
    data: { status: accept ? QuoteRequestStatus.ACCEPTED : QuoteRequestStatus.DECLINED },
  });
  refresh(projectId);
}
