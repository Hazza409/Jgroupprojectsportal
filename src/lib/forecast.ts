import { createHash } from "crypto";
import { Role } from "@prisma/client";
import { db } from "./db";

// ─────────────────────────────────────────────────────────────
// THE FORTNIGHTLY SIGN-OFF GATE.
//
// Jake's rule: "Nothing publishes without ... fortnightly sign-off."
// This module is that rule in code. Sign-off currently sits with Nick;
// the approver list is configurable in Company settings.
//
//   1. A builder enters figures → they land in the PENDING fields. A client
//      sees nothing new; the previously published figure stays up.
//   2. Every configured approver must sign the CURRENT revision.
//   3. The last required signature publishes it — that signature IS the
//      authority to publish, so there's no "signed but forgotten" state.
//
// Editing the figures changes the revision fingerprint, which silently voids
// every signature already given. You cannot sign revision A and publish B.
// ─────────────────────────────────────────────────────────────

/** Fingerprint of a pending revision. Any change to the figures changes this. */
export function forecastRevision(input: {
  finalCostCents: number | null;
  completionDate: Date | null;
  costNote: string | null;
  dateNote: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        c: input.finalCostCents,
        d: input.completionDate ? input.completionDate.toISOString().slice(0, 10) : null,
        cn: input.costNote ?? "",
        dn: input.dateNote ?? "",
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

/** Configured approver emails, normalised. Empty array = gate not configured. */
export function approverEmails(company: { forecastApprovers: string | null }): string[] {
  return (company.forecastApprovers ?? "")
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export interface ForecastGate {
  /** Emails that must sign. */
  required: string[];
  /** Signatures already recorded against the current pending revision. */
  signed: { email: string; name: string; at: Date }[];
  /** Required emails still outstanding. */
  outstanding: string[];
  /** True when the sign-off requirement is satisfied for the current revision. */
  complete: boolean;
  /** True when there are pending figures at all. */
  hasPending: boolean;
  /**
   * Set when no named approvers are configured. The two-person control is NOT
   * being enforced in that state — any staff sign-off publishes — so this is
   * surfaced prominently rather than silently blocking forever.
   */
  warning: string | null;
  /** True when no named approvers are configured. */
  unconfigured: boolean;
  /**
   * Configured approver emails with no matching staff account. These can never
   * sign, so they'd deadlock publishing — surfaced so a typo is obvious rather
   * than silently freezing the fortnightly figures.
   */
  unmatched: string[];
  revision: string | null;
}

/**
 * Current state of the gate for a project.
 *
 * The company is passed IN rather than looked up here: a bare
 * `company.findFirst()` picks an arbitrary row once more than one company
 * exists, which would silently read the wrong approver list and defeat the
 * gate. Callers pass the row from getCompany().
 */
export async function forecastGate(
  projectId: string,
  company: { forecastApprovers: string | null },
): Promise<ForecastGate> {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { pendingForecastRevision: true, pendingForecastFinalCostCents: true, pendingForecastCompletionDate: true },
  });

  const required = approverEmails(company);
  const revision = project.pendingForecastRevision;
  const hasPending =
    revision !== null &&
    (project.pendingForecastFinalCostCents !== null || project.pendingForecastCompletionDate !== null);

  const rows = revision
    ? await db.forecastSignoff.findMany({
        where: { projectId, revision },
        orderBy: { signedAt: "asc" },
        select: { signedByEmail: true, signedByName: true, signedAt: true },
      })
    : [];
  const signed = rows.map((r) => ({ email: r.signedByEmail.toLowerCase(), name: r.signedByName, at: r.signedAt }));
  const signedSet = new Set(signed.map((s) => s.email));
  const outstanding = required.filter((e) => !signedSet.has(e));

  const unconfigured = required.length === 0;

  // A configured approver with no staff account could never sign, which would
  // freeze publishing with no explanation. Detect it so the cause is visible.
  const staff = required.length
    ? await db.user.findMany({
        where: { email: { in: required, mode: "insensitive" }, role: Role.BUILDER },
        select: { email: true },
      })
    : [];
  const staffSet = new Set(staff.map((s) => s.email.toLowerCase()));
  const unmatched = required.filter((e) => !staffSet.has(e));

  return {
    required,
    signed,
    outstanding,
    // Configured: every named approver must sign. Unconfigured: any one staff
    // sign-off publishes — otherwise the figures could never reach the client
    // at all, which is worse than an unenforced control that says so loudly.
    complete: hasPending && (unconfigured ? signed.length > 0 : outstanding.length === 0),
    hasPending,
    unconfigured,
    unmatched,
    warning: unconfigured
      ? "No named approver is configured, so sign-off is NOT being enforced — any staff member can publish. Add Nick in Company settings to enforce it."
      : unmatched.length
        ? `No staff account matches ${unmatched.join(", ")}, so nobody can sign these figures off. Check the address in Company settings, or add the staff account.`
        : null,
    revision,
  };
}
