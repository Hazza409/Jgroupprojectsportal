"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { syncProjectActuals } from "@/lib/xero/sync";
import { parseCostRowsBuffer } from "@/lib/excel/parseCurrentCosts";
import { parseCtcWorkbookBuffer } from "@/lib/excel/parseCtcWorkbook";
import { VariationStatus } from "@prisma/client";
import { rematerializeProjectClaims } from "@/lib/claims";

export interface SyncResult {
  ok: boolean;
  message: string;
}

// Builder-triggered re-match: re-links every approved claim's lines to cost
// codes (fuzzy name matching) and re-posts them into the cost feed. Run after
// fixing cost-code names or when claim lines show up as Unallocated.
export async function rematchClaimCosts(projectId: string): Promise<void> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders re-match costs");
  await rematerializeProjectClaims(projectId);
  revalidatePath(`/projects/${projectId}/cost-to-complete`);
  revalidatePath(`/projects/${projectId}`);
}

// Builder-triggered pull of actuals from Xero into CostActual (one-directional).
export async function syncXero(projectId: string): Promise<SyncResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders sync Xero");

  try {
    const { upserted, unmatched } = await syncProjectActuals(projectId);
    revalidatePath(`/projects/${projectId}/cost-to-complete`);
    const distinctUnmatched = Array.from(new Set(unmatched));
    const tail = distinctUnmatched.length
      ? ` ${distinctUnmatched.length} account code(s) had no matching cost code: ${distinctUnmatched.slice(0, 5).join(", ")}.`
      : "";
    return { ok: true, message: `Synced ${upserted} actual line(s) from Xero.${tail}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Xero sync failed." };
  }
}

// Import / update cost codes from Excel: estimate (budget) and/or current cost
// to date per code. Upserts one CostActual per code (keyed import:<code>) and,
// when an estimate is given, replaces that code's estimate line. Either column
// may be blank to leave that side unchanged.
export async function importCurrentCosts(projectId: string, formData: FormData): Promise<SyncResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders import costs");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "No file uploaded." };
  if (!/\.(xlsx?|csv)$/i.test(file.name)) return { ok: false, message: "Please upload an .xlsx, .xls or .csv file." };

  const buf = Buffer.from(await file.arrayBuffer());
  // Try the full "Cost to Complete Workings" workbook FIRST — it anchors on
  // unambiguous section titles. The simple template's generic headers ("Code",
  // "Amount") otherwise mis-latch onto the workbook and ingest its Total row as
  // a cost code, doubling Current to Date.
  let rows: Awaited<ReturnType<typeof parseCostRowsBuffer>>["rows"];
  let warnings: string[];
  let importedVariations = 0;
  const wbk = parseCtcWorkbookBuffer(buf);
  if (wbk.rows.length > 0) {
    rows = wbk.rows;
    warnings = wbk.warnings;
    // Seed approved variations from the workbook ONLY if none exist yet (avoid dupes
    // on re-import; variations are otherwise managed in the Variations module).
    if (wbk.variations.length > 0 && (await db.variation.count({ where: { projectId } })) === 0) {
      let n = 1;
      for (const v of wbk.variations) {
        const approved = v.amountCents !== null;
        const variation = await db.variation.create({
          data: {
            projectId,
            variationNumber: n++,
            title: v.title,
            status: approved ? VariationStatus.APPROVED : VariationStatus.DRAFT,
            totalCents: v.amountCents ?? 0,
            approvedAt: approved ? new Date() : null,
          },
        });
        if (approved) {
          await db.variationLineItem.create({
            data: { variationId: variation.id, description: v.title, quantity: 1, unit: "item", unitCostCents: v.amountCents!, totalCents: v.amountCents! },
          });
        }
        importedVariations++;
      }
    }
  } else {
    const simple = parseCostRowsBuffer(buf);
    rows = simple.rows;
    warnings = simple.warnings;
  }
  if (rows.length === 0) return { ok: false, message: warnings[0] ?? "No rows parsed." };

  // Double-count guard: 'import:<code>' rows are ABSOLUTE cost-to-date and would
  // stack on top of per-period claim/Xero actuals for the same code. Warn (don't
  // silently corrupt) so the builder decides which source to keep. Claim/Xero
  // actuals carry a costCodeId, so detect overlap by cost code.
  const importCodeStrings = rows.filter((r) => r.currentCents !== null).map((r) => r.code);
  const existingCodes = importCodeStrings.length
    ? await db.costCode.findMany({ where: { projectId, code: { in: importCodeStrings } }, select: { id: true, code: true } })
    : [];
  const overlapCodes = existingCodes.length
    ? await db.costActual.findMany({
        where: {
          projectId,
          costCodeId: { in: existingCodes.map((c) => c.id) },
          NOT: { xeroSourceId: { startsWith: "import:" } },
        },
        select: { costCodeId: true },
        distinct: ["costCodeId"],
      })
    : [];
  const overlapCodeLabels = overlapCodes
    .map((o) => existingCodes.find((c) => c.id === o.costCodeId)?.code)
    .filter(Boolean);

  let estimateUpdates = 0;
  let currentUpdates = 0;

  for (const row of rows) {
    const cc = await db.costCode.upsert({
      where: { projectId_code: { projectId, code: row.code } },
      create: { projectId, code: row.code, name: row.name },
      update: { name: row.name },
    });

    // Estimate: replace this code's estimate line(s) with a single line.
    if (row.estimateCents !== null) {
      await db.estimateLineItem.deleteMany({ where: { projectId, costCodeId: cc.id } });
      await db.estimateLineItem.create({
        data: {
          projectId,
          costCodeId: cc.id,
          description: row.name,
          quantity: 1,
          unit: "item",
          unitCostCents: row.estimateCents,
          totalCents: row.estimateCents,
        },
      });
      estimateUpdates++;
    }

    // Current cost to date: upsert the imported actual for this code.
    if (row.currentCents !== null) {
      await db.costActual.upsert({
        where: { projectId_xeroSourceId: { projectId, xeroSourceId: `import:${row.code}` } },
        create: {
          projectId,
          costCodeId: cc.id,
          xeroAccountCode: row.code,
          xeroSourceId: `import:${row.code}`,
          description: "Current cost (imported)",
          amountCents: row.currentCents,
          occurredAt: new Date(),
        },
        update: { amountCents: row.currentCents, costCodeId: cc.id, syncedAt: new Date() },
      });
      currentUpdates++;
    }
  }

  revalidatePath(`/projects/${projectId}/cost-to-complete`);
  revalidatePath(`/projects/${projectId}/estimate`);
  revalidatePath(`/projects/${projectId}/variations`);
  const varNote = importedVariations > 0 ? `, ${importedVariations} variation(s)` : "";
  const overlapNote = overlapCodeLabels.length
    ? ` ⚠ ${overlapCodeLabels.length} code(s) also have costs from approved claims or Xero (${overlapCodeLabels.slice(0, 6).join(", ")}${overlapCodeLabels.length > 6 ? "…" : ""}) — Current to Date now counts BOTH. Remove one source to avoid double-counting.`
    : "";
  return {
    ok: true,
    message: `Updated ${rows.length} cost code(s) — ${estimateUpdates} estimate, ${currentUpdates} current cost${varNote}.${overlapNote}`,
  };
}
