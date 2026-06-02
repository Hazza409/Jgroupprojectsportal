import type { EmailDriver, EmailMessage } from "./index";

// Prod driver: Resend (https://resend.com). Set EMAIL_DRIVER=resend,
// RESEND_API_KEY and EMAIL_FROM (a verified sender) in the environment.
// Swap for SMTP/SES/Postmark later by adding a sibling driver — no caller change.
export class ResendEmail implements EmailDriver {
  async send(msg: EmailMessage): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      throw new Error("RESEND_API_KEY and EMAIL_FROM are required when EMAIL_DRIVER=resend");
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  }
}
