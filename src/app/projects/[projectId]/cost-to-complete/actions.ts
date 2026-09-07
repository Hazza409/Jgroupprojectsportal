"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { syncProjectActuals } from "@/lib/xero/sync";
import { parseCostRowsBuffer } from "@/lib/excel/parseCurrentCosts";
import { parseCtcWorkbookBuffer } from "@/lib/excel/parseCtcWorkbook";
import { listReconTabs, parseReconciliationBuffer } from "@/lib/excel/parseReconciliation";
import { VariationStatus } from "@prisma/client";
import { matchCostCodeId, normalizeCostName, projectCodeRefs, rematerializeProjectClaims } from "@/lib/claims";
import { getProjectRates } from "@/lib/company";
import { formatCents } from "@/lib/money";

const fmtCents = (c: number) => formatCents(c);

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

// ── Mid-job opening position ──────────────────────────────────
// A job that transfers in part-built has already spent money the dashboard
// never saw. Replaying every historical claim would mean recording dozens of
// approvals that happened outside the system, so instead we carry the
// cumulative position across in one move, from the running reconciliation
// sheet's "To Date" column.
//
// Absolute, not incremental: each cost code gets ONE row keyed
// `opening:<code>`, upserted, so re-running corrects rather than doubles. It
// shares the `import:` rows' meaning ("this IS the cost to date for this
// code"), so the two are mutually exclusive — importing an opening position
// clears any manual cost import, and vice versa is warned about.

export interface OpeningPositionResult extends SyncResult {
  warnings?: string[];
  /** Tabs available in the uploaded workbook, so the UI can offer a choice. */
  tabs?: { name: string; invoiceNumber: number | null }[];
  usedTab?: string;
  /**
   * Sheet lines that matched no cost code, with the money behind them, so the
   * builder can map them to a budget line instead of leaving them Unallocated.
   */
  unmatched?: { label: string; cents: number }[];
  /** This project's cost codes, to populate the mapping dropdowns. */
  codes?: { id: string; code: string; name: string }[];
}

export async function listOpeningTabs(projectId: string, formData: FormData): Promise<OpeningPositionResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders import costs");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "No file uploaded." };
  if (!/\.xlsx?$/i.test(file.name)) return { ok: false, message: "Please upload the reconciliation .xlsx file." };

  const tabs = listReconTabs(Buffer.from(await file.arrayBuffer()));
  const withNumbers = tabs.filter((t) => t.invoiceNumber !== null);
  if (withNumbers.length === 0) {
    return { ok: false, message: "No invoice tabs found in that workbook (expected tabs like \"Invoice 54 - Jul-26\")." };
  }
  return { ok: true, message: `${withNumbers.length} invoice tab(s) found.`, tabs: withNumbers };
}

export async function importOpeningPosition(projectId: string, formData: FormData): Promise<OpeningPositionResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders import costs");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "No file uploaded." };
  if (!/\.xlsx?$/i.test(file.name)) return { ok: false, message: "Please upload the reconciliation .xlsx file." };
  const tab = String(formData.get("tab") ?? "").trim() || undefined;

  const buf = Buffer.from(await file.arrayBuffer());
  const company = await getProjectRates(projectId);
  const parsed = parseReconciliationBuffer(buf, company.marginPercent, company.gstPercent, tab);
  if (parsed.budgetOverview.length === 0) {
    return {
      ok: false,
      message:
        `No Budget Overview rows found on "${parsed.sheetName}". The opening position comes from that ` +
        `section's "To Date" column, so there is nothing to carry across.`,
    };
  }

  const warnings = [...parsed.warnings];

  // The sheet states the rate it was billed at ("Builders Margin Current
  // Invoice 12.5%"). If the job is set up on a different rate, every
  // client-facing figure here is grossed wrongly — and nothing else catches
  // it, because de-grossing and re-grossing by the same wrong rate always
  // reconciles. This is the only place the true rate is visible, so check it.
  if (Number.isFinite(parsed.marginPercent) && Math.abs(parsed.marginPercent - company.marginPercent) > 0.01) {
    warnings.push(
      `Margin mismatch: this sheet bills builder's margin at ${parsed.marginPercent}%, but the job is set ` +
        `up at ${company.marginPercent}%. Every figure shown to the client is grossed at the job's rate, so ` +
        `set the job's margin to ${parsed.marginPercent}% in Settings before relying on these numbers.`,
    );
  }

  // Rows to post: every cost code, plus labour as its own line. Labour sits in
  // its own section of the sheet and never appears in the Budget Overview.
  const rows: { name: string; cents: number }[] = parsed.budgetOverview.map((b) => ({
    name: b.name,
    cents: b.toDateCents,
  }));
  if (parsed.labourToDateCents !== 0) rows.push({ name: "Labour", cents: parsed.labourToDateCents });

  const codes = await projectCodeRefs(projectId);
  if (codes.length === 0) {
    return {
      ok: false,
      message:
        "This job has no cost codes yet. Import the estimate first — the opening position is matched " +
        "against the approved budget's cost codes.",
    };
  }

  const occurredAt = parsed.meta.date ?? new Date();
  const label = parsed.meta.invoiceNumber
    ? `Opening position — invoice #${parsed.meta.invoiceNumber}${parsed.meta.periodLabel ? ` (${parsed.meta.periodLabel})` : ""}`
    : `Opening position — ${parsed.sheetName}`;

  // Clear any prior opening position so a re-import with FEWER rows can't leave
  // stale codes behind, and drop manual `import:` rows, which mean the same
  // thing and would stack.
  await db.costActual.deleteMany({
    where: { projectId, OR: [{ xeroSourceId: { startsWith: "opening:" } }, { xeroSourceId: { startsWith: "import:" } }] },
  });

  let posted = 0;
  let matchedCents = 0;
  let unallocatedCents = 0;
  const misses: { label: string; cents: number }[] = [];

  for (const row of rows) {
    const costCodeId = matchCostCodeId(row.name, codes);
    if (!costCodeId && row.cents !== 0) misses.push({ label: row.name, cents: row.cents });
    if (row.cents === 0) continue; // nothing spent — no need for a row
    if (costCodeId) matchedCents += row.cents;
    else unallocatedCents += row.cents;

    // Keyed by the SOURCE LINE, not the cost code, so several sheet lines can
    // point at one budget line without colliding on the unique key — that is
    // what makes a merge ("Mechanical" + "Mechanical Ventilation" → one code)
    // possible. Unmatched lines still get a row, with a null cost code, so the
    // money shows as Unallocated rather than vanishing.
    const xeroSourceId = `opening:${normalizeCostName(row.name) || `row${posted}`}`;
    await db.costActual.create({
      data: {
        projectId,
        costCodeId,
        xeroSourceId,
        description: `${label} — ${row.name}`,
        amountCents: row.cents,
        occurredAt,
      },
    });
    posted++;
  }

  // Claim-derived actuals are per-period; an opening position is cumulative.
  // Both present means the carried-forward months are counted twice.
  const claimActuals = await db.costActual.count({
    where: { projectId, xeroSourceId: { startsWith: "claim:" } },
  });
  if (claimActuals > 0) {
    warnings.push(
      `This job already has costs from ${claimActuals} approved claim line(s). An opening position is ` +
        `cumulative, so any month covered by both is now counted twice. Keep the opening position for ` +
        `history and enter claims only for periods AFTER invoice #${parsed.meta.invoiceNumber ?? "?"}.`,
    );
  }

  // The chosen tab's own period, unallocated. Reported because it is money the
  // client has been invoiced that no cost code accounts for.
  const currentAllocated = parsed.budgetOverview.reduce((a, b) => a + b.currentCents, 0);
  const currentUnallocated = parsed.costsCents - currentAllocated;
  if (currentUnallocated > 100) {
    warnings.push(
      `On "${parsed.sheetName}", suppliers total ${fmtCents(parsed.costsCents)} but the Budget Overview ` +
        `"Current" column only accounts for ${fmtCents(currentAllocated)} — ${fmtCents(currentUnallocated)} ` +
        `of that month is not allocated to any cost code, so it is NOT in this opening position.`,
    );
  }

  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}/cost-to-complete`);
  revalidatePath(`/projects/${projectId}/overruns`);
  revalidatePath(`/projects/${projectId}`);

  const codeList = await db.costCode.findMany({
    where: { projectId },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  return {
    ok: true,
    usedTab: parsed.sheetName,
    warnings,
    unmatched: misses.sort((a, b) => b.cents - a.cents),
    codes: codeList,
    message:
      `Carried across ${posted} line(s) from "${parsed.sheetName}": ${fmtCents(matchedCents)} against cost ` +
      `codes${unallocatedCents ? `, ${fmtCents(unallocatedCents)} unallocated` : ""}. ` +
      `Total spend to date ${fmtCents(matchedCents + unallocatedCents)} (base, before margin and GST).`,
  };
}

/**
 * Record that a source sheet's trade name belongs to a given cost code, and
 * re-point money already carried in under that name. This is how two sheet
 * lines get merged into one budget line, and how a naming difference
 * ("Swimming Pool" vs a "Pools" code) is closed permanently — later imports
 * match on the alias without asking again.
 */
export async function setCostCodeAlias(projectId: string, formData: FormData): Promise<SyncResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders map cost codes");

  const sourceLabel = String(formData.get("sourceLabel") ?? "").trim();
  const costCodeId = String(formData.get("costCodeId") ?? "").trim();
  if (!sourceLabel) return { ok: false, message: "No source line given." };

  const alias = normalizeCostName(sourceLabel);
  if (!alias) return { ok: false, message: `"${sourceLabel}" has no letters or digits to match on.` };

  // Clearing a mapping: drop the alias and send the money back to Unallocated,
  // so an incorrect merge is fully reversible.
  if (!costCodeId) {
    await db.costCodeAlias.deleteMany({ where: { projectId, alias } });
    await db.costActual.updateMany({
      where: { projectId, xeroSourceId: `opening:${alias}` },
      data: { costCodeId: null },
    });
    revalidatePath(`/projects/${projectId}/budget`);
    return { ok: true, message: `Unmapped "${sourceLabel}" — its costs show as Unallocated again.` };
  }

  const cc = await db.costCode.findFirst({ where: { id: costCodeId, projectId }, select: { id: true, code: true, name: true } });
  if (!cc) return { ok: false, message: "That cost code isn't on this job." };

  await db.costCodeAlias.upsert({
    where: { projectId_alias: { projectId, alias } },
    create: { projectId, costCodeId: cc.id, alias, sourceLabel },
    update: { costCodeId: cc.id, sourceLabel },
  });

  // Re-point anything already carried in under this name. Opening rows are
  // keyed by source line, so several can sit against one cost code and their
  // amounts add up — which is exactly what a merge should do.
  const moved = await db.costActual.updateMany({
    where: { projectId, xeroSourceId: `opening:${alias}` },
    data: { costCodeId: cc.id },
  });

  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}/cost-to-complete`);
  revalidatePath(`/projects/${projectId}/overruns`);
  revalidatePath(`/projects/${projectId}`);

  return {
    ok: true,
    message:
      `"${sourceLabel}" now maps to ${cc.code} ${cc.name}` +
      `${moved.count ? ` — ${moved.count} carried-in line moved off Unallocated.` : "."}`,
  };
}
