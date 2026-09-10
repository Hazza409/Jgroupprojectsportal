// Email abstraction. Code never talks to a mail provider directly — only through
// this interface, so dev logs to the server console and prod sends via Resend
// (or any driver added later) with no code change. Notifications must never
// break the user action that triggered them, so helpers swallow + log errors.

import { db } from "../db";
import { getCompany } from "../company";

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  /** Sender display name (from Company settings). Drivers may ignore it. */
  fromName?: string;
}

export interface EmailDriver {
  send(msg: EmailMessage): Promise<void>;
}

let driver: EmailDriver | null = null;

async function email(): Promise<EmailDriver> {
  if (driver) return driver;
  const kind = process.env.EMAIL_DRIVER ?? "console";
  if (kind === "resend") {
    const { ResendEmail } = await import("./resend");
    driver = new ResendEmail();
  } else if (kind === "smtp" || kind === "gmail") {
    const { SmtpEmail } = await import("./smtp");
    driver = new SmtpEmail();
  } else {
    const { ConsoleEmail } = await import("./console");
    driver = new ConsoleEmail();
  }
  return driver;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/**
 * Recipients for a project-level notification: the builder team (all builders).
 * (Could later be narrowed to PMs assigned to the specific project.)
 */
export async function builderRecipients(): Promise<string[]> {
  const builders = await db.user.findMany({ where: { role: "BUILDER" }, select: { email: true } });
  return builders.map((b) => b.email);
}

/** Notify the builder team. Fire-safe: logs and returns on any failure. */
export async function notifyBuilders(subject: string, lines: string[]): Promise<void> {
  try {
    const to = await builderRecipients();
    if (to.length === 0) return;
    await sendLines(to, subject, lines);
  } catch (e) {
    console.error("[email] notifyBuilders failed:", e);
  }
}

/**
 * A project's members split by role. "PMs" = the builders assigned to
 * the project (via membership). Optionally exclude the user who triggered the
 * change so they aren't emailed about their own action.
 */
export async function projectMemberEmails(
  projectId: string,
  opts: { excludeUserId?: string } = {},
): Promise<{ clients: string[]; pms: string[] }> {
  const memberships = await db.projectMembership.findMany({
    where: { projectId, ...(opts.excludeUserId ? { userId: { not: opts.excludeUserId } } : {}) },
    include: { user: { select: { email: true, role: true } } },
  });
  const clients = memberships.filter((m) => m.user.role === "CLIENT").map((m) => m.user.email);
  const pms = memberships.filter((m) => m.user.role === "BUILDER").map((m) => m.user.email);
  return { clients, pms };
}

/**
 * Notify a project's client(s) AND PM(s) of a change made on the project.
 * Fire-safe. In dev/console mode this just logs; in prod it sends via Resend
 * once EMAIL_DRIVER=resend + keys are set.
 */
export async function notifyProject(
  projectId: string,
  subject: string,
  lines: string[],
  opts: { excludeUserId?: string } = {},
): Promise<void> {
  try {
    const { clients, pms } = await projectMemberEmails(projectId, opts);
    const to = Array.from(new Set([...clients, ...pms]));
    if (to.length === 0) return;
    await sendLines(to, subject, lines);
  } catch (e) {
    console.error("[email] notifyProject failed:", e);
  }
}

/**
 * Shared: render lines into a simple email and send. Sends to each recipient
 * INDIVIDUALLY so no-one sees the others' addresses — a project can have several
 * client logins plus the architect plus the builder PM, and they must not be
 * disclosed to each other in a visible To: header.
 */
async function sendLines(to: string[], subject: string, lines: string[]): Promise<void> {
  const company = await getCompany();
  const text = lines.join("\n");
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1a1a1a">${lines
    .map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`)
    .join("")}</div>`;
  const driver = await email();
  for (const addr of to) {
    await driver.send({ to: [addr], subject, html, text, fromName: company.name });
  }
}

// ── Audience-aware notification ───────────────────────────────
// notifyProject sends ONE message to clients and builders together, which
// forces every notification into wording that suits neither: a client reading
// "Claim #55 submitted for review" does not need the Xero reminder, and a
// builder does not need telling how to approve it.
//
// This sends a DIFFERENT message to each side of the same event. Either half
// may be omitted when only one audience needs to hear about it.

export interface AudienceMessage {
  subject: string;
  lines: string[];
}

export async function notifyProjectSplit(
  projectId: string,
  opts: {
    client?: AudienceMessage;
    builder?: AudienceMessage;
    /** Don't email the person who caused the event. */
    excludeUserId?: string;
  },
): Promise<void> {
  try {
    const { clients, pms } = await projectMemberEmails(projectId, { excludeUserId: opts.excludeUserId });
    if (opts.client && clients.length > 0) {
      await sendLines(Array.from(new Set(clients)), opts.client.subject, opts.client.lines);
    }
    if (opts.builder) {
      // The builder side goes to the whole team, not only those with a
      // membership row: a client rejecting a claim is something J Group needs
      // to see even if the PM who set the job up has moved on.
      const team = await builderRecipients();
      const to = Array.from(new Set([...team, ...pms]));
      if (to.length > 0) await sendLines(to, opts.builder.subject, opts.builder.lines);
    }
  } catch (e) {
    console.error("[email] notifyProjectSplit failed:", e);
  }
}

/**
 * Which driver is live and whether it can actually send. Surfaced to builders
 * so "did the client get an email?" has an answer that isn't a guess — this
 * app spent weeks logging to the console because an app password could not be
 * created, and nothing on screen said so.
 */
export function emailStatus(): {
  driver: string;
  sends: boolean;
  detail: string;
} {
  const kind = process.env.EMAIL_DRIVER ?? "console";
  if (kind === "resend") {
    const key = !!process.env.RESEND_API_KEY;
    return {
      driver: "Resend",
      sends: key,
      detail: key ? "Sending through Resend." : "EMAIL_DRIVER is resend but RESEND_API_KEY is not set — nothing sends.",
    };
  }
  if (kind === "smtp" || kind === "gmail") {
    const ok = !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
    return {
      driver: `SMTP (${process.env.SMTP_USER ?? "no sender set"})`,
      sends: ok,
      detail: ok
        ? `Sending as ${process.env.SMTP_USER}.`
        : "EMAIL_DRIVER is smtp but SMTP_USER/SMTP_PASS are not both set — nothing sends.",
    };
  }
  return {
    driver: "Console",
    sends: false,
    detail:
      "No mail provider configured, so notifications are only written to the server log — no client or " +
      "builder receives anything. Set EMAIL_DRIVER in Render to switch sending on.",
  };
}

/** Send one message to one address, so a builder can prove sending works. */
export async function sendTestEmail(to: string): Promise<{ ok: boolean; message: string }> {
  const status = emailStatus();
  try {
    await sendLines(
      [to],
      "Test email from the J Group dashboard",
      [
        "This is a test, sent from the dashboard's notification settings.",
        `Active mail driver: ${status.driver}.`,
        "If you are reading this in your inbox, client and builder notifications will send.",
      ],
    );
    // ok tracks whether a MESSAGE ACTUALLY LEFT, not whether the call threw.
    // The console driver "succeeds" at writing to a log, and reporting that as
    // success in green while the text says nothing was sent is exactly the
    // confusion this card exists to remove.
    return {
      ok: status.sends,
      message: status.sends
        ? `Sent to ${to}. If it doesn't arrive within a few minutes, check spam and the sender's reputation.`
        : `Nothing left the server — the driver is ${status.driver}. ${status.detail}`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Sending failed." };
  }
}
