"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { syncProjectActuals } from "@/lib/xero/sync";
import { parseCostRowsBuffer } from "@/lib/excel/parseCurrentCosts";
import { parseCtcWorkbookBuffer } from "@/lib/excel/parseCtcWorkbook";
import { VariationStatus } from "@prisma/client";

export interface SyncResult {
  ok: boolean;
  message: string;
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
  if (!/\.xlsx?$/i.test(file.name)) return { ok: false, message: "Please upload an .xlsx or .xls file." };

  const buf = Buffer.from(await file.arrayBuffer());
  // Accept either the simple template OR the full "Cost to Complete Workings" workbook.
  let { rows, warnings } = parseCostRowsBuffer(buf);
  let importedVariations = 0;
  if (rows.length === 0) {
    const wbk = parseCtcWorkbookBuffer(buf);
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
  }
  if (rows.length === 0) return { ok: false, message: warnings[0] ?? "No rows parsed." };

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
  return {
    ok: true,
    message: `Updated ${rows.length} cost code(s) — ${estimateUpdates} estimate, ${currentUpdates} current cost${varNote}.`,
  };
}
