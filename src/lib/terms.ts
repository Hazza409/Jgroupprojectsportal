import { db } from "./db";
import { contentFingerprint } from "./audit";
import { LEGAL_DOCS, currentTermsVersion, termsInForce } from "./legal";

/**
 * Acceptance of the terms of use.
 *
 * Every function here is a no-op while the terms are a draft. That is
 * deliberate: recording that someone "accepted" placeholder wording would be a
 * legal fiction, and a fiction in an evidence ledger is worse than a gap. When
 * a solicitor settles the text and `inForce` is flipped, this starts working
 * with no further changes.
 */

/** Fingerprint of the exact text of the terms as they stand. */
export function termsContentHash(): string {
  const t = LEGAL_DOCS.terms;
  return contentFingerprint({
    version: t.version,
    sections: t.sections.map((s) => ({ heading: s.heading, body: s.body ?? "" })),
  });
}

/**
 * Does this user still need to accept? False whenever the terms are a draft,
 * so nothing is asked of anyone until there is something real to agree to.
 */
export async function needsTermsAcceptance(userId: string): Promise<boolean> {
  if (!termsInForce()) return false;
  const existing = await db.termsAcceptance.findUnique({
    where: { userId_version: { userId, version: currentTermsVersion() } },
    select: { id: true },
  });
  return existing === null;
}

/**
 * Record acceptance. Idempotent per user and version — clicking twice, or a
 * retried request, must not produce two records of one agreement.
 */
export async function recordTermsAcceptance(userId: string): Promise<{ ok: boolean; message: string }> {
  if (!termsInForce()) {
    return { ok: false, message: "The terms are still a draft — there is nothing to accept yet." };
  }
  const version = currentTermsVersion();
  await db.termsAcceptance.upsert({
    where: { userId_version: { userId, version } },
    create: { userId, version, contentHash: termsContentHash() },
    update: {}, // never overwrite the original timestamp
  });
  return { ok: true, message: `Terms accepted (version ${version}).` };
}

/** Every version this user has accepted, oldest first — the audit view. */
export async function termsAcceptancesFor(userId: string) {
  return db.termsAcceptance.findMany({
    where: { userId },
    orderBy: { acceptedAt: "asc" },
    select: { version: true, contentHash: true, acceptedAt: true },
  });
}
