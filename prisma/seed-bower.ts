/**
 * Seed the real "8 Bower Street, Manly" (J-01022) project from the J Group
 * Cost-to-Complete + Construction Programme exports. Idempotent: wipes and
 * recreates the project each run. Money is stored as integer cents.
 *
 *   npm run seed:bower
 */
import { readFileSync } from "fs";
import path from "path";
import { PrismaClient, Role, VariationStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();
const c = (dollars: number) => Math.round(dollars * 100);
const dir = path.join(process.cwd(), "prisma", "seed-data");

interface CtcCode { code: string; name: string; current: number; estimate: number }
interface CtcVar { title: string; amount: number | null; status: "APPROVED" | "DRAFT" }
interface Ctc { codes: CtcCode[]; variations: CtcVar[] }
interface SchedTask { group: string; name: string; duration: number; progress: number }

const ctc: Ctc = JSON.parse(readFileSync(path.join(dir, "bower-ctc.json"), "utf8"));
const sched: SchedTask[] = JSON.parse(readFileSync(path.join(dir, "bower-schedule.json"), "utf8"));

// Synthesize a believable timeline: stagger tasks across the programme window
// (Oct 2025 → Apr 2027), each bar as wide as its real duration.
function scheduleDates(index: number, total: number, durationDays: number) {
  const start = new Date(Date.UTC(2025, 9, 1)); // 2025-10-01
  const windowDays = 575; // ~ to 2027-04-29
  const step = (windowDays - 60) / Math.max(total, 1);
  const offset = Math.round(index * step);
  const startDate = new Date(start.getTime() + offset * 86_400_000);
  const dur = durationDays > 0 ? durationDays : 1;
  const endDate = new Date(startDate.getTime() + dur * 86_400_000);
  return { startDate, endDate };
}

async function main() {
  await db.project.deleteMany({ where: { name: "8 Bower Street, Manly" } });

  const builder = await db.user.findFirst({ where: { role: Role.BUILDER } });

  const project = await db.project.create({
    data: {
      name: "8 Bower Street, Manly",
      address: "8 Bower Street, Manly NSW 2095",
      clientName: "David & Anna Duckworth",
      // Headline contract value (ex the CTC revised-estimate roll-up).
      contractValueCents: c(8_817_525.11),
      status: "ACTIVE",
      memberships: builder ? { create: [{ userId: builder.id, role: Role.BUILDER }] } : undefined,
    },
  });

  // Client login scoped to Bower Street.
  const clientEmail = "duckworth@example.test";
  const client = await db.user.upsert({
    where: { email: clientEmail },
    update: {},
    create: {
      email: clientEmail,
      name: "David Duckworth",
      role: Role.CLIENT,
      passwordHash: await bcrypt.hash("client123", 10),
    },
  });
  await db.projectMembership.create({
    data: { userId: client.id, projectId: project.id, role: Role.CLIENT },
  });

  // Cost codes + estimate line items + current-cost actuals.
  for (const cc of ctc.codes) {
    const code = await db.costCode.create({
      data: { projectId: project.id, code: cc.code, name: cc.name },
    });
    if (cc.estimate > 0) {
      await db.estimateLineItem.create({
        data: {
          projectId: project.id,
          costCodeId: code.id,
          description: cc.name,
          quantity: 1,
          unit: "item",
          unitCostCents: c(cc.estimate),
          totalCents: c(cc.estimate),
        },
      });
    }
    if (cc.current > 0) {
      await db.costActual.create({
        data: {
          projectId: project.id,
          costCodeId: code.id,
          xeroAccountCode: cc.code,
          xeroSourceId: `seed:${cc.code}`,
          description: "Current cost to date (imported)",
          amountCents: c(cc.current),
          occurredAt: new Date(),
        },
      });
    }
  }

  // Variations (approved carry an amount; drafts are pending pricing).
  let vn = 1;
  for (const v of ctc.variations) {
    const status = v.status === "APPROVED" ? VariationStatus.APPROVED : VariationStatus.DRAFT;
    const totalCents = v.amount ? c(v.amount) : 0;
    const variation = await db.variation.create({
      data: {
        projectId: project.id,
        variationNumber: vn++,
        title: v.title,
        status,
        totalCents,
        approvedAt: status === VariationStatus.APPROVED ? new Date() : null,
      },
    });
    if (totalCents > 0) {
      await db.variationLineItem.create({
        data: {
          variationId: variation.id,
          description: v.title,
          quantity: 1,
          unit: "item",
          unitCostCents: totalCents,
          totalCents,
        },
      });
    }
  }

  // Schedule items, grouped by trade.
  await db.scheduleItem.createMany({
    data: sched.map((t, i) => {
      const { startDate, endDate } = scheduleDates(i, sched.length, t.duration);
      return {
        projectId: project.id,
        group: t.group,
        taskName: t.name,
        durationDays: t.duration,
        percentComplete: t.progress,
        startDate,
        endDate,
        sortOrder: i,
      };
    }),
  });

  const counts = {
    codes: ctc.codes.length,
    variations: ctc.variations.length,
    schedule: sched.length,
  };
  console.log(`Seeded "8 Bower Street, Manly" (${project.id})`);
  console.log(`  ${counts.codes} cost codes, ${counts.variations} variations, ${counts.schedule} schedule tasks`);
  console.log(`  Client login: ${clientEmail} / client123`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
