/**
 * Tenancy exit-test seed (SAAS-PLAN M2): a SECOND company with its own builder,
 * client and project, alongside J Group. Proves the tenancy walls hold — nothing
 * from one company may be reachable from the other.
 *
 *   npm run seed:tenants   (idempotent; dev only)
 */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const company = await db.company.upsert({
    where: { id: "company_rivertown" },
    update: {},
    create: {
      id: "company_rivertown",
      name: "Rivertown Builders",
      shortName: "Rivertown",
      tagline: "Built On Trust",
      location: "Brisbane",
      marginPercent: 18,
      gstPercent: 10,
    },
  });

  const hash = (pw: string) => bcrypt.hash(pw, 10);

  const builder = await db.user.upsert({
    where: { email: "builder@rivertown.test" },
    update: {},
    create: {
      email: "builder@rivertown.test",
      name: "Riley (Rivertown)",
      role: Role.BUILDER,
      passwordHash: await hash("rivertown123"),
      companyId: company.id,
    },
  });

  const client = await db.user.upsert({
    where: { email: "client@rivertown.test" },
    update: {},
    create: {
      email: "client@rivertown.test",
      name: "Casey Client (Rivertown)",
      role: Role.CLIENT,
      passwordHash: await hash("client123"),
      companyId: company.id,
    },
  });

  const existing = await db.project.findFirst({ where: { companyId: company.id } });
  if (!existing) {
    await db.project.create({
      data: {
        companyId: company.id,
        name: "New Farm Riverhouse",
        address: "8 Moray St, New Farm QLD",
        clientName: "Casey Client",
        contractValueCents: 195_000_000,
        memberships: {
          create: [
            { userId: builder.id, role: Role.BUILDER },
            { userId: client.id, role: Role.CLIENT },
          ],
        },
      },
    });
  }

  console.log("Seeded second tenant. Logins:");
  console.log("  BUILDER  builder@rivertown.test / rivertown123");
  console.log("  CLIENT   client@rivertown.test  / client123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
