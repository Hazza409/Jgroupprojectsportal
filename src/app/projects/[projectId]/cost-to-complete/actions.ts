"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { syncProjectActuals } from "@/lib/xero/sync";

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
