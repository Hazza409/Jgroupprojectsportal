/**
 * Exercise the notification layer end to end against the LOCAL dev database:
 * seed a project with a client and a builder, fire the split notification,
 * and let the console driver print exactly what each audience receives.
 * Cleans up after itself. Not part of the app.
 *
 * getCompany() is wrapped in React's cache(), which only exists inside a Next
 * render, so it is stubbed before anything is imported — hence the dynamic
 * imports below rather than top-level ones.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const react = require("react");
if (typeof react.cache !== "function") react.cache = (f: (...a: unknown[]) => unknown) => f;

async function main() {
  const { db } = await import("../src/lib/db");
  const { emailStatus, notifyProjectSplit, sendTestEmail } = await import("../src/lib/email");

  const s = emailStatus();
  console.log(`driver : ${s.driver}`);
  console.log(`sends  : ${s.sends}`);
  console.log(`detail : ${s.detail}\n`);

  const project = await db.project.create({ data: { name: "ZZ email test", status: "ACTIVE" } });
  const client = await db.user.create({
    data: { email: "zz-client@example.test", name: "Test Client", role: "CLIENT", passwordHash: "x" },
  });
  const builder = await db.user.create({
    data: { email: "zz-builder@example.test", name: "Test Builder", role: "BUILDER", passwordHash: "x" },
  });
  await db.projectMembership.createMany({
    data: [
      { userId: client.id, projectId: project.id, role: "CLIENT" },
      { userId: builder.id, projectId: project.id, role: "BUILDER" },
    ],
  });

  console.log("── one event, two audiences ────────────────────────────────\n");
  await notifyProjectSplit(project.id, {
    client: {
      subject: "Progress claim for review — ZZ email test",
      lines: [
        "J Group has issued Progress Claim #12 for your review.",
        "Amount: $243,705.26 (incl margin & GST).",
        "Open the portal to see the breakdown and approve it.",
      ],
    },
    builder: {
      subject: "Claim #12 issued to the client — ZZ email test",
      lines: [
        "Claim #12 was issued on ZZ email test for $243,705.26.",
        "The Xero invoice push is a separate, manual step.",
      ],
    },
  });

  console.log("\n── test email ──────────────────────────────────────────────");
  console.log(JSON.stringify(await sendTestEmail("zz-someone@example.test")));

  await db.projectMembership.deleteMany({ where: { projectId: project.id } });
  await db.project.delete({ where: { id: project.id } });
  await db.user.deleteMany({ where: { email: { in: [client.email, builder.email] } } });
  console.log("\ncleaned up");
  await db.$disconnect();
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
