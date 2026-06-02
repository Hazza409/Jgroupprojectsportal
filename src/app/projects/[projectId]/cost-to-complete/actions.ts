"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { syncProjectActuals } from "@/lib/xero/sync";
import { parseCurrentCostsBuffer } from "@/lib/excel/parseCurrentCosts";

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

// Import current costs to date from Excel (alternative to Xero). Upserts one
// CostActual per cost code, keyed import:<code>, so re-importing replaces.
export async function importCurrentCosts(projectId: string, formData: FormData): Promise<SyncResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders import costs");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "No file uploaded." };
  if (!/\.xlsx?$/i.test(file.name)) return { ok: false, message: "Please upload an .xlsx or .xls file." };

  const { rows, warnings } = parseCurrentCostsBuffer(Buffer.from(await file.arrayBuffer()));
  if (rows.length === 0) return { ok: false, message: warnings[0] ?? "No rows parsed." };

  for (const row of rows) {
    const cc = await db.costCode.upsert({
      where: { projectId_code: { projectId, code: row.code } },
      create: { projectId, code: row.code, name: row.name },
      update: {},
    });
    await db.costActual.upsert({
      where: { projectId_xeroSourceId: { projectId, xeroSourceId: `import:${row.code}` } },
      create: {
        projectId,
        costCodeId: cc.id,
        xeroAccountCode: row.code,
        xeroSourceId: `import:${row.code}`,
        description: "Current cost (imported)",
        amountCents: row.amountCents,
        occurredAt: new Date(),
      },
      update: { amountCents: row.amountCents, costCodeId: cc.id, syncedAt: new Date() },
    });
  }

  revalidatePath(`/projects/${projectId}/cost-to-complete`);
  return { ok: true, message: `Imported current costs for ${rows.length} cost code(s).` };
}
