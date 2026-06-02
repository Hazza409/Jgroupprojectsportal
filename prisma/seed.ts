/**
 * Seed: builder + two clients, two projects, scoped memberships, cost codes,
 * an imported estimate, schedule, a variation, a progress claim, calendar event.
 * Idempotent on users/projects via upsert-by-natural-key where possible.
 *
 * Run: npm run seed   (after prisma migrate)
 */
import { PrismaClient, Role, ClaimStatus, VariationStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function user(email: string, name: string, role: Role, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  return db.user.upsert({
    where: { email },
    update: { name, role, passwordHash },
    create: { email, name, role, passwordHash },
  });
}

async function main() {
  // ── Users ─────────────────────────────────────────────────
  const builder = await user("builder@jgroup.test", "Jordan (J Group)", Role.BUILDER, "builder123");
  const clientA = await user("client.a@example.test", "Alex Client", Role.CLIENT, "client123");
  const clientB = await user("client.b@example.test", "Bailey Client", Role.CLIENT, "client123");

  // ── Project A (fully populated) ───────────────────────────
  const projectA = await db.project.create({
    data: {
      name: "Hawthorn Residence",
      address: "12 Riverview Tce, Hawthorn VIC",
      clientName: "Alex Client",
      contractValueCents: 285_000_000, // $2,850,000.00
      memberships: {
        create: [
          { userId: builder.id, role: Role.BUILDER },
          { userId: clientA.id, role: Role.CLIENT },
        ],
      },
    },
  });

  // Cost codes + an estimate import with line items.
  const codeData: [string, string, number, number][] = [
    // [code, name, unitCostCents, totalCents]
    ["1.00", "Preliminaries", 2_850_000, 2_850_000],
    ["3.10", "Concrete", 4_070_000, 4_070_000],
    ["4.10", "Framing", 9_650_000, 9_650_000],
    ["7.30", "Joinery & fit-out", 17_800_000, 17_800_000],
    ["8.10", "Electrical", 6_450_000, 6_450_000],
    ["8.20", "Plumbing", 7_100_000, 7_100_000],
  ];

  const codeMap = new Map<string, string>();
  for (const [code, name] of codeData) {
    const cc = await db.costCode.create({ data: { projectId: projectA.id, code, name } });
    codeMap.set(code, cc.id);
  }

  const estImport = await db.estimateImport.create({
    data: {
      projectId: projectA.id,
      sourceKey: "seed://hawthorn-estimate.xlsx",
      originalName: "hawthorn-estimate.xlsx",
      rowCount: codeData.length,
      importedById: builder.id,
    },
  });
  await db.estimateLineItem.createMany({
    data: codeData.map(([code, name, unitCostCents, totalCents], i) => ({
      projectId: projectA.id,
      importId: estImport.id,
      costCodeId: codeMap.get(code)!,
      description: name,
      quantity: 1,
      unit: "item",
      unitCostCents,
      totalCents,
      sortOrder: i,
    })),
  });

  // A few Xero-style actuals so Cost-to-Complete shows progress.
  await db.costActual.createMany({
    data: [
      { projectId: projectA.id, costCodeId: codeMap.get("1.00")!, xeroAccountCode: "1.00", xeroSourceId: "seed-1", amountCents: 2_850_000, occurredAt: new Date("2026-02-20") },
      { projectId: projectA.id, costCodeId: codeMap.get("3.10")!, xeroAccountCode: "3.10", xeroSourceId: "seed-2", amountCents: 3_200_000, occurredAt: new Date("2026-03-25") },
      { projectId: projectA.id, costCodeId: codeMap.get("4.10")!, xeroAccountCode: "4.10", xeroSourceId: "seed-3", amountCents: 3_900_000, occurredAt: new Date("2026-04-30") },
    ],
  });

  // Schedule.
  await db.scheduleItem.createMany({
    data: [
      { projectId: projectA.id, taskName: "Footings & slab", startDate: new Date("2026-03-09"), endDate: new Date("2026-03-27"), percentComplete: 80, sortOrder: 0 },
      { projectId: projectA.id, taskName: "Frame", startDate: new Date("2026-03-30"), endDate: new Date("2026-05-01"), percentComplete: 40, sortOrder: 1 },
      { projectId: projectA.id, taskName: "Roof", startDate: new Date("2026-05-04"), endDate: new Date("2026-05-22"), percentComplete: 0, sortOrder: 2 },
    ],
  });

  // A submitted variation awaiting client approval.
  await db.variation.create({
    data: {
      projectId: projectA.id,
      variationNumber: 1,
      title: "Upgrade to natural stone benchtops",
      description: "Client-requested upgrade from engineered stone.",
      status: VariationStatus.SUBMITTED,
      totalCents: 1_850_000,
      lines: { create: [{ description: "Natural stone supply & install", quantity: 1, unit: "item", unitCostCents: 1_850_000, totalCents: 1_850_000 }] },
    },
  });

  // A draft progress claim with one line.
  await db.progressClaim.create({
    data: {
      projectId: projectA.id,
      claimNumber: 1,
      status: ClaimStatus.DRAFT,
      lines: {
        create: [
          { description: "Concrete — slab complete", costCodeId: codeMap.get("3.10"), percentComplete: 100, claimedAmountCents: 4_070_000 },
          { description: "Framing — 40%", costCodeId: codeMap.get("4.10"), percentComplete: 40, claimedAmountCents: 3_860_000 },
        ],
      },
    },
  });

  // A site meeting.
  await db.calendarEvent.create({
    data: {
      projectId: projectA.id,
      title: "Fortnightly site meeting",
      location: "On site",
      startsAt: new Date("2026-06-10T09:00:00"),
      endsAt: new Date("2026-06-10T10:00:00"),
      createdById: builder.id,
    },
  });

  // ── Project B (second client, isolation check) ────────────
  await db.project.create({
    data: {
      name: "Toorak Townhouse",
      address: "5 Linden St, Toorak VIC",
      clientName: "Bailey Client",
      contractValueCents: 162_500_000,
      memberships: {
        create: [
          { userId: builder.id, role: Role.BUILDER },
          { userId: clientB.id, role: Role.CLIENT },
        ],
      },
    },
  });

  console.log("Seeded. Logins:");
  console.log("  BUILDER  builder@jgroup.test / builder123  (sees all projects)");
  console.log("  CLIENT   client.a@example.test / client123 (Hawthorn Residence only)");
  console.log("  CLIENT   client.b@example.test / client123 (Toorak Townhouse only)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
