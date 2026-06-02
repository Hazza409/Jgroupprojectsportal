import type { EmailDriver, EmailMessage } from "./index";

// Dev driver: prints the email to the server console instead of sending. Lets
// you see exactly what would go out without configuring a provider.
export class ConsoleEmail implements EmailDriver {
  async send(msg: EmailMessage): Promise<void> {
    console.log(
      [
        "",
        "──────────── EMAIL (console driver) ────────────",
        `To:      ${msg.to.join(", ")}`,
        `Subject: ${msg.subject}`,
        "",
        msg.text ?? msg.html,
        "────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  }
}
