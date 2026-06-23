/**
 * ensure-admin — runs automatically at server startup (see package.json "start").
 *
 * Purpose: a brand-new deployment has an empty database, which would lock
 * everyone out. This guarantees there is always at least one builder login to
 * sign in with, WITHOUT needing the Render Shell.
 *
 * Safe by design:
 *   - Only creates the login when the database has ZERO users (a fresh deploy).
 *   - Once you have any users, it does nothing — it will never reset a password
 *     or touch your real data on later deploys.
 *   - Never crashes the deploy: any error is logged and swallowed so the app
 *     still starts.
 *
 * Plain CommonJS + node (no tsx / no TypeScript) so it always runs in production.
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const EMAIL = "builder@jgroup.test";
const PASSWORD = "builder123";
const NAME = "J Group Projects";

(async () => {
  const db = new PrismaClient();
  try {
    const count = await db.user.count();
    if (count > 0) {
      console.log(`[ensure-admin] ${count} user(s) already present — leaving everything as-is.`);
      return;
    }
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await db.user.create({
      data: { email: EMAIL, name: NAME, role: "BUILDER", passwordHash },
    });
    console.log(`[ensure-admin] empty database — created initial builder login: ${EMAIL} / ${PASSWORD}`);
  } catch (e) {
    // Don't block startup if this fails for any reason.
    console.error("[ensure-admin] skipped (non-fatal):", e && e.message ? e.message : e);
  } finally {
    await db.$disconnect();
  }
})();
