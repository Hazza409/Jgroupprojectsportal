/**
 * Checks the assumptions behind deleteVariation on the LOCAL dev database:
 * that a variation's line items cascade away with it, and that a withdrawal
 * recorded in the Decision Register OUTLIVES the variation it describes —
 * which is the whole point of recording it before the delete.
 *
 *   npx tsx scripts/test-delete-variation.ts
 */
import { db } from "../src/lib/db";

async function main() {
  const project = await db.project.create({
    data: { name: "ZZ delete-variation test", status: "ACTIVE" },
  });

  const v = await db.variation.create({
    data: {
      projectId: project.id,
      variationNumber: 9001,
      title: "Withdrawn while with the client",
      status: "SUBMITTED",
      totalCents: 50_000_00,
      lines: {
        create: [
          { description: "line one", quantity: 1, unit: "item", unitCostCents: 30_000_00, totalCents: 30_000_00 },
          { description: "line two", quantity: 1, unit: "item", unitCostCents: 20_000_00, totalCents: 20_000_00 },
        ],
      },
    },
    include: { lines: true },
  });
  console.log(`created variation #${v.variationNumber} (SUBMITTED) with ${v.lines.length} lines`);

  await db.decisionRecord.create({
    data: {
      projectId: project.id,
      subjectType: "VARIATION",
      subjectId: v.id,
      subjectRef: `Variation #${v.variationNumber}`,
      subjectTitle: v.title,
      action: "WITHDRAWN",
      actorName: "Test Builder",
      actorEmail: "test@example.com",
      actorRole: "BUILDER",
      amountCents: 61_875_00,
      detail: "Withdrawn and deleted while awaiting the client's decision.",
    },
  });

  await db.variation.delete({ where: { id: v.id } });

  const gone = await db.variation.findUnique({ where: { id: v.id } });
  const orphanLines = await db.variationLineItem.count({ where: { variationId: v.id } });
  const records = await db.decisionRecord.findMany({
    where: { subjectType: "VARIATION", subjectId: v.id },
    select: { action: true, subjectRef: true, subjectTitle: true, amountCents: true, detail: true },
  });

  console.log(`variation deleted:            ${gone === null ? "yes" : "NO — still present"}`);
  console.log(`line items cascaded:          ${orphanLines === 0 ? "yes" : `NO — ${orphanLines} orphan(s)`}`);
  console.log(`decision record survived:     ${records.length === 1 ? "yes" : `NO — found ${records.length}`}`);
  if (records[0]) {
    const r = records[0];
    console.log(`  ${r.action} · ${r.subjectRef} · ${r.subjectTitle} · ${(r.amountCents ?? 0) / 100}`);
    console.log(`  "${r.detail}"`);
  }

  const pass = gone === null && orphanLines === 0 && records.length === 1;
  await db.project.delete({ where: { id: project.id } });
  console.log(`\n${pass ? "PASS" : "FAIL"} — cleaned up`);
  if (!pass) process.exit(1);
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
