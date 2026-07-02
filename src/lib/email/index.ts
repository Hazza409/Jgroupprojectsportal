// Email abstraction. Code never talks to a mail provider directly — only through
// this interface, so dev logs to the server console and prod sends via Resend
// (or any driver added later) with no code change. Notifications must never
// break the user action that triggered them, so helpers swallow + log errors.

import { db } from "../db";

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text?: string;
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
 * Recipients for a project-level notification: the J Group team (all builders).
 * (Could later be narrowed to PMs assigned to the specific project.)
 */
export async function builderRecipients(): Promise<string[]> {
  const builders = await db.user.findMany({ where: { role: "BUILDER" }, select: { email: true } });
  return builders.map((b) => b.email);
}

/** Notify the J Group team. Fire-safe: logs and returns on any failure. */
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
 * A project's members split by role. "PMs" = the J Group builders assigned to
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
 * client logins plus the architect plus the J Group PM, and they must not be
 * disclosed to each other in a visible To: header.
 */
async function sendLines(to: string[], subject: string, lines: string[]): Promise<void> {
  const text = lines.join("\n");
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1a1a1a">${lines
    .map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`)
    .join("")}</div>`;
  const driver = await email();
  for (const addr of to) {
    await driver.send({ to: [addr], subject, html, text });
  }
}
