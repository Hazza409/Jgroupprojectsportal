import { createHash } from "crypto";
import { DecisionAction, DecisionSubject, Role } from "@prisma/client";
import { db } from "./db";
import type { SessionUser } from "@/auth";

// ─────────────────────────────────────────────────────────────
// The evidence layer. Once live, the portal is the record — for us
// and against us. Every client decision lands here as an APPEND-ONLY
// row capturing who, exactly when, and exactly what was decided.
//
// RULES (Jake §2):
//  1. Never update or delete a DecisionRecord. A correction is a NEW
//     row with a note — visible correction, never a silent edit.
//  2. Actor identity is denormalised so the record survives a user
//     being renamed or removed.
//  3. The amount and a content fingerprint are frozen at click time,
//     so we can prove WHICH version was approved.
// ─────────────────────────────────────────────────────────────

/**
 * Placeholder authority wording shown under every Approve button.
 * TODO(Andrew): final wording to be supplied and locked — this sentence is
 * what turns a click into contractual acceptance, so it must be his words.
 */
export const AUTHORITY_STATEMENT =
  "By approving, you authorise these works and the associated cost adjustment under the contract.";

/** Wording for acknowledgements — receipt, explicitly NOT approval. */
export const ACKNOWLEDGEMENT_STATEMENT =
  "Acknowledging confirms you have received and read this. It is not an approval of cost.";

/**
 * Stable fingerprint of the exact content being approved. Stored with the
 * decision so a later edit can never be passed off as what was approved.
 */
export function contentFingerprint(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

export interface RecordDecisionInput {
  projectId: string;
  subjectType: DecisionSubject;
  subjectId: string;
  /** Human reference frozen at action time, e.g. "Variation #4". */
  subjectRef: string;
  subjectTitle?: string | null;
  action: DecisionAction;
  actor: SessionUser;
  amountCents?: number | null;
  versionHash?: string | null;
  detail?: string | null;
}

/** Append one immutable row to the decision ledger. */
export async function recordDecision(input: RecordDecisionInput) {
  return db.decisionRecord.create({
    data: {
      projectId: input.projectId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectRef: input.subjectRef,
      subjectTitle: input.subjectTitle ?? null,
      action: input.action,
      actorId: input.actor.id,
      actorName: input.actor.name,
      actorEmail: input.actor.email,
      actorRole: input.actor.role,
      amountCents: input.amountCents ?? null,
      versionHash: input.versionHash ?? null,
      detail: input.detail ?? null,
    },
  });
}

/** Has this user already acknowledged this subject? (Acknowledge once.) */
export async function hasAcknowledged(subjectType: DecisionSubject, subjectId: string, userId: string) {
  const n = await db.decisionRecord.count({
    where: { subjectType, subjectId, actorId: userId, action: DecisionAction.ACKNOWLEDGED },
  });
  return n > 0;
}

/** Every acknowledgement for a subject (builder-facing evidence). */
export async function acknowledgementsFor(subjectType: DecisionSubject, subjectId: string) {
  return db.decisionRecord.findMany({
    where: { subjectType, subjectId, action: DecisionAction.ACKNOWLEDGED },
    orderBy: { occurredAt: "asc" },
    select: { actorName: true, occurredAt: true },
  });
}

/**
 * Internal-only view logging. Records that a CLIENT-side user opened something.
 * Builder/staff activity isn't logged — this exists to answer "they say they
 * never saw variation #14". Never surfaced to clients.
 *
 * Best-effort: a logging failure must never break the page the user asked for.
 */
export async function logView(projectId: string, user: SessionUser, path: string, label?: string) {
  if (user.role === Role.BUILDER) return; // internal staff aren't tracked
  try {
    await db.viewLog.create({
      data: {
        projectId,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        path,
        label: label ?? null,
      },
    });
  } catch {
    // Swallow — analytics must never take down a page.
  }
}

/**
 * Record a CLIENT sign-in against every project they can reach (Jake §2:
 * "client-side logins"). Clients typically hold one project, so this stays
 * small. Best-effort — never block or fail a sign-in.
 */
export async function logClientLogin(user: { id: string; name: string; email: string; role: Role }) {
  if (user.role === Role.BUILDER) return;
  try {
    const memberships = await db.projectMembership.findMany({
      where: { userId: user.id },
      select: { projectId: true },
    });
    if (memberships.length === 0) return;
    await db.viewLog.createMany({
      data: memberships.map((m) => ({
        projectId: m.projectId,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        path: "/login",
        label: "Signed in",
      })),
    });
  } catch {
    // Never let analytics break authentication.
  }
}

/** Acknowledgements for a claim, including actorId so the UI can tell whether
 *  the CURRENT user has already acknowledged it. */
export async function acknowledgementsForClaim(claimId: string) {
  return db.decisionRecord.findMany({
    where: { subjectType: DecisionSubject.CLAIM, subjectId: claimId, action: DecisionAction.ACKNOWLEDGED },
    orderBy: { occurredAt: "asc" },
    select: { actorId: true, actorName: true, occurredAt: true },
  });
}
