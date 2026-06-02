// ─────────────────────────────────────────────────────────────
// Xero → dashboard cost sync. ONE-DIRECTIONAL. Reads actuals from Xero and
// maps them onto CostCode rows (matched by code) into CostActual.
//
// This is the service INTERFACE + mapping logic. The Xero API fetch is a TODO;
// the upsert/mapping shape below is real so the rest of the app can build
// against it and a cron/route can call syncProjectActuals() once wired.
// ─────────────────────────────────────────────────────────────

import { db } from "../db";
import { dollarsToCents } from "../money";

export interface XeroActualRow {
  xeroAccountCode: string; // maps to CostCode.code
  xeroSourceId: string; // invoice/bill/transaction id — idempotency key
  description?: string;
  amount: number | string; // dollars from Xero; converted to cents here
  occurredAt: Date;
}

/** TODO: call the Xero Accounting API (bank txns / bills) for this tenant. */
async function fetchActualsFromXero(_projectId: string): Promise<XeroActualRow[]> {
  // TODO: use stored XeroConnection tokens (refresh as needed) and pull
  // transactions since lastSyncedAt. Return them as XeroActualRow[].
  throw new Error("Xero actuals fetch not implemented (TODO). See src/lib/xero/sync.ts.");
}

/**
 * Map Xero rows onto the project's cost codes and upsert CostActual rows.
 * Pure mapping + persistence — safe to unit test by passing rows directly.
 */
export async function applyActuals(projectId: string, rows: XeroActualRow[]): Promise<{ upserted: number; unmatched: string[] }> {
  const codes = await db.costCode.findMany({ where: { projectId }, select: { id: true, code: true } });
  const byCode = new Map(codes.map((c) => [c.code, c.id]));
  const unmatched: string[] = [];
  let upserted = 0;

  for (const row of rows) {
    const costCodeId = byCode.get(row.xeroAccountCode) ?? null;
    if (!costCodeId) unmatched.push(row.xeroAccountCode);

    await db.costActual.upsert({
      where: { projectId_xeroSourceId: { projectId, xeroSourceId: row.xeroSourceId } },
      create: {
        projectId,
        costCodeId,
        xeroAccountCode: row.xeroAccountCode,
        xeroSourceId: row.xeroSourceId,
        description: row.description,
        amountCents: dollarsToCents(row.amount),
        occurredAt: row.occurredAt,
      },
      update: {
        costCodeId,
        amountCents: dollarsToCents(row.amount),
        description: row.description,
        syncedAt: new Date(),
      },
    });
    upserted++;
  }

  await db.xeroConnection.updateMany({
    where: { projectId },
    data: { lastSyncedAt: new Date() },
  });

  return { upserted, unmatched };
}

/** End-to-end sync entrypoint (fetch → map → persist). Fetch is the TODO. */
export async function syncProjectActuals(projectId: string) {
  const rows = await fetchActualsFromXero(projectId);
  return applyActuals(projectId, rows);
}
