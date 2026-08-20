"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { ProjectPhase, ProjectClientView, Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { dollarsToCents, exceedsInt4, tooLargeMessage, exMarginGst } from "@/lib/money";
import { forecastGate, restampForecastRevision, approverEmails } from "@/lib/forecast";
import { getCompany } from "@/lib/company";
import { validatePassword } from "@/lib/password";

export interface SimpleResult { ok: boolean; message: string }

// Builder sets/resets a client's login password. Scoped: the target user must be
// a CLIENT member of THIS project.
export async function setClientPassword(projectId: string, userId: string, formData: FormData): Promise<SimpleResult> {
  const actor = await assertProjectAccess(projectId);
  if (actor.role !== Role.BUILDER) throw new AccessError("Only builders manage client access");

  // Trim accidental edge whitespace — login compares exactly, so a stray space
  // would silently break sign-in.
  const password = String(formData.get("password") ?? "").trim();
  const pwCheck = validatePassword(password);
  if (!pwCheck.ok) return { ok: false, message: pwCheck.message! };

  const membership = await db.projectMembership.findFirst({
    where: { projectId, userId, user: { role: Role.CLIENT } },
    include: { user: { select: { email: true } } },
  });
  if (!membership) return { ok: false, message: "That client is not on this project." };

  await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  return { ok: true, message: `Password updated for ${membership.user.email}.` };
}

// Builder adds ANOTHER client login to this project (e.g. a second owner, or the
// architect). Multiple CLIENT members per project are fully supported. Creates a
// new CLIENT user or, if the email already exists as a client, updates their
// password and grants access. Never touches a J Group staff account.
export async function addClientToProject(projectId: string, formData: FormData): Promise<SimpleResult> {
  const actor = await assertProjectAccess(projectId);
  if (actor.role !== Role.BUILDER) throw new AccessError("Only builders manage client access");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").trim();
  if (!name) return { ok: false, message: "Name is required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Enter a valid email." };
  const pwCheck = validatePassword(password);
  if (!pwCheck.ok) return { ok: false, message: pwCheck.message! };

  const existing = await db.user.findUnique({ where: { email } });
  let userId: string;
  if (!existing) {
    const u = await db.user.create({
      data: { email, name, role: Role.CLIENT, passwordHash: await bcrypt.hash(password, 10) },
    });
    userId = u.id;
  } else if (existing.role === Role.CLIENT) {
    await db.user.update({ where: { id: existing.id }, data: { passwordHash: await bcrypt.hash(password, 10), name } });
    userId = existing.id;
  } else {
    return { ok: false, message: "That email belongs to a staff account." };
  }

  await db.projectMembership.upsert({
    where: { userId_projectId: { userId, projectId } },
    create: { userId, projectId, role: Role.CLIENT },
    update: {},
  });
  revalidatePath(`/projects/${projectId}/settings`);
  return { ok: true, message: `${email} can now sign in to this project.` };
}

// Builder revokes a client's access to THIS project (removes the membership;
// the user account itself is kept in case they're on other projects).
export async function removeClientFromProject(projectId: string, userId: string): Promise<SimpleResult> {
  const actor = await assertProjectAccess(projectId);
  if (actor.role !== Role.BUILDER) throw new AccessError("Only builders manage client access");
  await db.projectMembership.deleteMany({ where: { projectId, userId, user: { role: Role.CLIENT } } });
  revalidatePath(`/projects/${projectId}/settings`);
  return { ok: true, message: "Access removed." };
}

const ORDER: ProjectPhase[] = [ProjectPhase.BUILD, ProjectPhase.HANDOVER, ProjectPhase.MAINTENANCE];

// Builder advances (or sets) the project's lifecycle phase. Data in every module
// stays accessible regardless of phase — this only changes which suite is primary.
export async function setPhase(projectId: string, phase: ProjectPhase) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders change the project phase");
  if (!ORDER.includes(phase)) throw new Error("Invalid phase");
  await db.project.update({ where: { id: projectId }, data: { phase } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

const CLIENT_VIEWS: ProjectClientView[] = [ProjectClientView.CONSTRUCTION, ProjectClientView.HANDOVER];

// Builder chooses what the CLIENT sees: the construction modules, or the combined
// Handover & Maintenance area. Builders always see everything regardless — this
// only changes the client's view (and is enforced server-side in the layout).
export async function setClientView(projectId: string, view: ProjectClientView) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders change the client view");
  if (!CLIENT_VIEWS.includes(view)) throw new Error("Invalid client view");
  await db.project.update({ where: { id: projectId }, data: { clientView: view } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

/**
 * Record the fortnightly forecast figures (Jake §3).
 *
 * BOTH NUMBERS COME FROM NICK & ANDREW — the portal must never calculate or
 * infer them. This action only stores what a builder types in, rolling the
 * previous value into *Prev so the dashboard can show movement since the last
 * statement.
 */
export async function setForecasts(projectId: string, formData: FormData): Promise<SimpleResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) return { ok: false, message: "Builder access required." };

  const costRaw = String(formData.get("forecastFinalCost") ?? "").trim();
  const dateRaw = String(formData.get("forecastCompletionDate") ?? "").trim();
  const costNote = String(formData.get("forecastFinalCostNote") ?? "").trim() || null;
  const dateNote = String(formData.get("forecastCompletionNote") ?? "").trim() || null;

  const nextCost = costRaw ? dollarsToCents(costRaw) : null;
  const nextDate = dateRaw ? new Date(dateRaw) : null;
  if (dateRaw && Number.isNaN(nextDate!.getTime())) return { ok: false, message: "Completion date is not a valid date." };

  // Staged only — NOT client-visible. Publishing happens on full sign-off.
  await db.project.update({
    where: { id: projectId },
    data: {
      pendingForecastFinalCostCents: nextCost,
      pendingForecastFinalCostNote: costNote,
      pendingForecastCompletionDate: nextDate,
      pendingForecastCompletionNote: dateNote,
      pendingForecastUpdatedAt: new Date(),
      pendingForecastUpdatedBy: user.name,
    },
  });

  // Restamp AFTER writing, from everything staged — headline figures and line
  // forecasts together. Hashing only the headline here would produce a revision
  // that doesn't cover staged lines, so a signature could publish line figures
  // it never described.
  await restampForecastRevision(projectId);

  revalidatePath(`/projects/${projectId}/settings`);
  const gate = await forecastGate(projectId, await getCompany());
  return {
    ok: true,
    message: gate.unconfigured
      ? "Figures staged — sign off below to publish them to the client."
      : `Figures staged — awaiting sign-off from ${gate.outstanding.join(", ")}. The client still sees the last published figures.`,
  };
}

/**
 * An approver signs off the CURRENT pending revision. When the last required
 * approver signs, the figures publish to the client in the same step — that
 * signature is the authority to publish, so nothing can sit "signed but
 * unpublished".
 */
export async function signOffForecast(projectId: string): Promise<SimpleResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) return { ok: false, message: "Builder access required." };

  const gate = await forecastGate(projectId, await getCompany());
  if (!gate.hasPending) return { ok: false, message: "There are no staged figures to sign off." };
  // When named approvers ARE configured, only they may sign. When none are
  // configured the control isn't enforced (the UI says so) and any builder may.
  if (!gate.unconfigured && !gate.required.includes(user.email.toLowerCase())) {
    return { ok: false, message: "You are not a configured sign-off approver for the fortnightly figures." };
  }

  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      pendingForecastFinalCostCents: true,
      pendingForecastFinalCostNote: true,
      pendingForecastCompletionDate: true,
      pendingForecastCompletionNote: true,
      pendingForecastRevision: true,
      forecastFinalCostCents: true,
      forecastCompletionDate: true,
    },
  });

  // Idempotent: signing twice is a no-op rather than an error.
  await db.forecastSignoff.upsert({
    where: {
      projectId_revision_signedByEmail: {
        projectId,
        revision: project.pendingForecastRevision!,
        signedByEmail: user.email.toLowerCase(),
      },
    },
    create: {
      projectId,
      revision: project.pendingForecastRevision!,
      signedById: user.id,
      signedByName: user.name,
      signedByEmail: user.email.toLowerCase(),
      finalCostCents: project.pendingForecastFinalCostCents,
      completionDate: project.pendingForecastCompletionDate,
    },
    update: {},
  });

  const after = await forecastGate(projectId, await getCompany());
  if (!after.complete) {
    revalidatePath(`/projects/${projectId}/settings`);
    return { ok: true, message: `Signed off. Still awaiting: ${after.outstanding.join(", ")}.` };
  }

  // Fully signed → publish. Roll the current published figures into *Prev so
  // the client sees the movement since the last statement.
  const costMoved =
    project.pendingForecastFinalCostCents !== null &&
    project.pendingForecastFinalCostCents !== project.forecastFinalCostCents;
  const dateMoved =
    project.pendingForecastCompletionDate !== null &&
    (project.forecastCompletionDate === null ||
      project.pendingForecastCompletionDate.getTime() !== project.forecastCompletionDate.getTime());

  await db.project.update({
    where: { id: projectId },
    data: {
      // Publish ONLY what was staged. A revision can be line-forecasts-only, or
      // date-only — its unstaged headline fields are null, and copying those
      // nulls across would WIPE a previously published figure off the client's
      // page as a side effect of signing something unrelated. `undefined`
      // means "leave the column alone"; withdrawing a published forecast, if
      // ever wanted, must be its own deliberate action — never a side effect.
      forecastFinalCostCents: project.pendingForecastFinalCostCents ?? undefined,
      forecastFinalCostPrevCents: costMoved ? project.forecastFinalCostCents : undefined,
      forecastFinalCostNote:
        project.pendingForecastFinalCostCents !== null ? project.pendingForecastFinalCostNote : undefined,
      forecastCompletionDate: project.pendingForecastCompletionDate ?? undefined,
      forecastCompletionPrevDate: dateMoved ? project.forecastCompletionDate : undefined,
      forecastCompletionNote:
        project.pendingForecastCompletionDate !== null ? project.pendingForecastCompletionNote : undefined,
      forecastUpdatedAt: new Date(),
      forecastUpdatedBy: after.signed.map((s) => s.name).join(" & "),
      // Clear the staging area — this revision is now the published truth.
      pendingForecastFinalCostCents: null,
      pendingForecastFinalCostNote: null,
      pendingForecastCompletionDate: null,
      pendingForecastCompletionNote: null,
      pendingForecastUpdatedAt: null,
      pendingForecastUpdatedBy: null,
      pendingForecastRevision: null,
    },
  });

  // Line forecasts belong to the same revision, so they publish in the same
  // act — a signature covers the headline figures AND the line detail behind
  // them. Done per row because each carries its own amount and note.
  const stagedLines = await db.costCode.findMany({
    where: { projectId, pendingForecastCents: { not: null } },
    select: { id: true, pendingForecastCents: true, pendingForecastNote: true },
  });
  const publishedAt = new Date();
  for (const line of stagedLines) {
    await db.costCode.update({
      where: { id: line.id },
      data: {
        forecastCents: line.pendingForecastCents,
        forecastNote: line.pendingForecastNote,
        forecastPublishedAt: publishedAt,
        pendingForecastCents: null,
        pendingForecastNote: null,
      },
    });
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}/overruns`);
  return {
    ok: true,
    message: `Signed off by all approvers (${after.signed.map((s) => s.name).join(", ")}) — figures are now published to the client.`,
  };
}

// ─────────────────────────────────────────────────────────────
// Builder corrects a job's headline details.
//
// These were writable only at creation, so a mistyped contract value could
// only be fixed by deleting the job — taking the estimate, claims, photos and
// documents with it. A digit dropped while re-keying the figure is exactly the
// kind of thing that needs a two-second fix, not a rebuild.
//
// Contract value is a display figure: nothing computes from it (Cost to
// Complete derives its own budget from the estimate and approved variations),
// so correcting it can't move any money that's already been claimed.
// ─────────────────────────────────────────────────────────────
export async function updateJobDetails(projectId: string, formData: FormData): Promise<SimpleResult> {
  const actor = await assertProjectAccess(projectId);
  if (actor.role !== Role.BUILDER) throw new AccessError("Only builders edit job details");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Job name is required." };
  const address = String(formData.get("address") ?? "").trim() || null;

  // Same guards as createJob — one rule for the same figure.
  const contractValueCents = dollarsToCents(String(formData.get("contractValue") ?? "0"));
  if (!Number.isFinite(contractValueCents) || contractValueCents < 0) {
    return { ok: false, message: "Contract value must be a positive amount." };
  }
  if (contractValueCents > Number.MAX_SAFE_INTEGER) {
    return { ok: false, message: "Contract value is too large." };
  }

  await db.project.update({
    where: { id: projectId },
    data: { name, address, contractValueCents },
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath("/builder");
  revalidatePath("/projects");
  return { ok: true, message: "Job details saved." };
}

// ─────────────────────────────────────────────────────────────
// Forecast a movement on ONE cost code, before spend passes the estimate.
//
// The point is notice. Without this a client only learns a line is running
// above its estimate once it already has — which on cost plus is both a poor
// experience and a weak position to argue from. A forecast entered early says
// "we now expect this to finish at X, here's why", on the record, in advance.
//
// Staged, not live: the client keeps seeing the last PUBLISHED figure until
// the revision is signed off, same as the headline forecast. Clearing the
// field withdraws the staged figure.
// ─────────────────────────────────────────────────────────────
export async function setLineForecast(
  projectId: string,
  costCodeId: string,
  formData: FormData,
): Promise<SimpleResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) return { ok: false, message: "Builder access required." };

  // Scope the cost code to THIS project — an id from another job must not be
  // writable through this route.
  const code = await db.costCode.findFirst({
    where: { id: costCodeId, projectId },
    select: { id: true, name: true },
  });
  if (!code) return { ok: false, message: "That cost code isn't on this project." };
  const company = await getCompany();

  const raw = String(formData.get("forecast") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  let cents: number | null = null;
  if (raw !== "") {
    const inclCents = dollarsToCents(raw);
    if (!Number.isFinite(inclCents) || inclCents < 0) {
      return { ok: false, message: "Forecast must be a positive amount." };
    }
    // The builder types the figure in the SAME form the page shows every other
    // amount: inc margin + GST. It is de-grossed here and stored as base cents
    // like estimates and actuals, then grossed exactly once on display. Storing
    // the typed figure as base was the original sin: type 146,000 against a
    // budget shown as $146,000 and the page displayed $180,675.
    cents = exMarginGst(inclCents, company);
    // Per-line amounts are 32-bit in the database, unlike the whole-project
    // figures. Say so plainly rather than surfacing a driver error.
    if (exceedsInt4(cents)) return { ok: false, message: tooLargeMessage("A single cost code's forecast") };
  }

  await db.costCode.update({
    where: { id: code.id },
    data: { pendingForecastCents: cents, pendingForecastNote: cents === null ? null : note },
  });

  // Restamp the whole revision: this edit voids any signatures already given.
  await restampForecastRevision(projectId);

  revalidatePath(`/projects/${projectId}/overruns`);
  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}/settings`);

  if (cents === null) return { ok: true, message: `Forecast withdrawn for ${code.name}.` };
  // Message composed from data already in hand — this used to run a full gate
  // evaluation (four more queries) purely to word this sentence, a solid share
  // of the frozen seconds after pressing Stage.
  const approvers = approverEmails(company);
  return {
    ok: true,
    message:
      approvers.length === 0
        ? `Forecast staged for ${code.name} — sign off above to publish it to the client.`
        : `Forecast staged for ${code.name} — publishes once signed off by ${approvers.join(", ")}.`,
  };
}
