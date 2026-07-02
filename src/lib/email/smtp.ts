import nodemailer from "nodemailer";
import type { EmailDriver, EmailMessage } from "./index";

// SMTP driver — sends through an existing mailbox, e.g. Google Workspace/Gmail
// with an App Password (no DNS setup needed since Google already sends the
// domain's mail). Env:
//   EMAIL_DRIVER=smtp
//   SMTP_USER=you@jgroupprojects.com     (the mailbox that sends)
//   SMTP_PASS=<16-char Gmail App Password>
//   SMTP_HOST=smtp.gmail.com (default) · SMTP_PORT=465 (default, TLS)
//   EMAIL_FROM optional — defaults to "J Group Projects <SMTP_USER>". Gmail
//   only lets you send as the authenticated mailbox (or its aliases).
export class SmtpEmail implements EmailDriver {
  private transporter;
  private from: string;

  constructor() {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) {
      throw new Error("SMTP_USER and SMTP_PASS are required when EMAIL_DRIVER=smtp");
    }
    const port = Number(process.env.SMTP_PORT ?? 465);
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port,
      secure: port === 465, // implicit TLS on 465; STARTTLS otherwise
      auth: { user, pass },
    });
    this.from = process.env.EMAIL_FROM || `J Group Projects <${user}>`;
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  }
}
