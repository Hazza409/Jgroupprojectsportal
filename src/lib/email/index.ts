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
    const text = lines.join("\n");
    const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1a1a1a">${lines
      .map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`)
      .join("")}</div>`;
    await (await email()).send({ to, subject, html, text });
  } catch (e) {
    console.error("[email] notifyBuilders failed:", e);
  }
}
