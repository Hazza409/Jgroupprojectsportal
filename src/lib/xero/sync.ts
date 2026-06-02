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
import { getValidAccessToken } from "./tokens";

const XERO_API = "https://api.xero.com/api.xro/2.0";

export interface XeroActualRow {
  xeroAccountCode: string; // maps to CostCode.code
  xeroSourceId: string; // invoice/bill/transaction id — idempotency key
  description?: string;
  amount: number | string; // dollars from Xero; converted to cents here
  occurredAt: Date;
}

// Shapes we read from the Xero Accounting API (only the fields we use).
interface XeroLineItem {
  AccountCode?: string;
  Description?: string;
  LineAmount?: number;
}
interface XeroDoc {
  InvoiceID?: string;
  BankTransactionID?: string;
  Date?: string; // "/Date(1234567890000+0000)/" or ISO
  LineItems?: XeroLineItem[];
}

/** Xero serialises dates as "/Date(ms+0000)/" for some endpoints; handle both. */
function parseXeroDate(value?: string): Date {
  if (!value) return new Date();
  const m = /\/Date\((\d+)/.exec(value);
  if (m) return new Date(Number(m[1]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function getJson(path: string, accessToken: string, tenantId: string, modifiedAfter?: Date | null) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "xero-tenant-id": tenantId,
    Accept: "application/json",
  };
  // Xero filters by last-modified via this header — keeps syncs incremental.
  if (modifiedAfter) headers["If-Modified-Since"] = modifiedAfter.toISOString().replace(/\.\d+Z$/, "Z");

  const res = await fetch(`${XERO_API}/${path}`, { headers });
  if (res.status === 304) return {} as { Invoices?: XeroDoc[]; BankTransactions?: XeroDoc[] }; // nothing modified since
  if (!res.ok) throw new Error(`Xero API ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { Invoices?: XeroDoc[]; BankTransactions?: XeroDoc[] };
}

function flatten(docs: XeroDoc[], idPrefix: string): XeroActualRow[] {
  const rows: XeroActualRow[] = [];
  for (const doc of docs) {
    const docId = doc.InvoiceID ?? doc.BankTransactionID ?? "";
    const occurredAt = parseXeroDate(doc.Date);
    (doc.LineItems ?? []).forEach((li, i) => {
      if (!li.AccountCode) return; // unmapped lines can't tie to a cost code
      rows.push({
        xeroAccountCode: li.AccountCode,
        xeroSourceId: `${idPrefix}:${docId}:${i}`,
        description: li.Description,
        amount: li.LineAmount ?? 0,
        occurredAt,
      });
    });
  }
  return rows;
}

/**
 * Pull job-cost actuals for the project's Xero org: supplier bills (ACCPAY) and
 * spend-money bank transactions. Incremental via lastSyncedAt. One-directional.
 */
async function fetchActualsFromXero(projectId: string): Promise<XeroActualRow[]> {
  const conn = await getValidAccessToken(projectId);
  if (!conn) throw new Error("Xero not connected for this project. Connect it first.");

  const record = await db.xeroConnection.findUnique({
    where: { projectId },
    select: { lastSyncedAt: true },
  });
  const since = record?.lastSyncedAt ?? null;

  const [bills, spend] = await Promise.all([
    getJson('Invoices?where=Type=="ACCPAY"', conn.accessToken, conn.tenantId, since),
    getJson('BankTransactions?where=Type=="SPEND"', conn.accessToken, conn.tenantId, since),
  ]);

  return [
    ...flatten(bills.Invoices ?? [], "bill"),
    ...flatten(spend.BankTransactions ?? [], "spend"),
  ];
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
