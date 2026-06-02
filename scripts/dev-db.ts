/**
 * Zero-dependency local Postgres for development — no Docker, no Homebrew.
 * Downloads/runs a real Postgres binary into ./.pgdata on port 5432 with
 * credentials matching DATABASE_URL (jgroup/jgroup, db "jgroup").
 *
 * Run (keep it running in its own terminal):  npm run dev:db
 * Stop: Ctrl-C. Data persists in ./.pgdata (gitignored).
 *
 * This is a convenience for machines without Docker. For a normal setup use
 * `npm run db:up` (docker-compose) instead.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "fs";
import path from "path";

const DATA_DIR = path.resolve(".pgdata");

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "jgroup",
    password: "jgroup",
    port: 5432,
    persistent: true,
  });

  // initialise() only on a fresh data dir (PG_VERSION marks an initialised cluster).
  if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    console.log("Initialising Postgres cluster in ./.pgdata …");
    await pg.initialise();
  }

  await pg.start();
  console.log("Postgres started on localhost:5432.");

  // Ensure the application database exists (ignore "already exists").
  try {
    await pg.createDatabase("jgroup");
    console.log('Created database "jgroup".');
  } catch {
    console.log('Database "jgroup" already present.');
  }

  console.log("\nReady. Leave this running. Next, in another terminal:");
  console.log("  npm run prisma:migrate   (first time)");
  console.log("  npm run seed\n");

  const shutdown = async () => {
    console.log("\nStopping Postgres …");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
