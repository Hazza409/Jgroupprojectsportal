"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
import { dollarsToCents, lineTotalCents } from "@/lib/money";
import { parseEstimateBuffer } from "@/lib/excel/parseEstimate";

export interface ImportResult {
  ok: boolean;
  message: string;
  rowCount?: number;
  warnings?: string[];
}

// Upload + parse an estimate xlsx → cost codes + estimate line items.
// Keeps the source file in storage and records an EstimateImport for audit.
export async function importEstimate(
  projectId: string,
  formData: FormData,
): Promise<ImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders import the estimate");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "No file uploaded." };
  }
  if (!/\.(xlsx?|csv)$/i.test(file.name)) {
    return { ok: false, message: "Please upload an .xlsx, .xls or .csv file." };
  }
  // Re-upload behaviour: when "Replace" is ticked (default), clear the existing
  // estimate lines first so a re-import resets the table instead of appending.
  const replace = !!formData.get("replace");

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseEstimateBuffer(buf);
  if (parsed.lines.length === 0) {
    return { ok: false, message: "No rows parsed.", warnings: parsed.warnings };
  }

  // Persist the original file (scoped key) before touching the DB.
  const store = await storage();
  const key = buildKey({
    projectId,
    category: "estimates",
    originalName: `${Date.now()}-${file.name}`,
  });
  await store.put({
    key,
    body: buf,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // Distinct cost codes referenced by this import.
  const codes = Array.from(
    new Set(parsed.lines.map((l) => l.costCode).filter((c): c is string => !!c)),
  );
  // First non-empty "Cost Code Description" seen per code → that code's name.
  const nameByCode = new Map<string, string>();
  for (const l of parsed.lines) {
    if (l.costCode && l.costCodeName && !nameByCode.has(l.costCode)) {
      nameByCode.set(l.costCode, l.costCodeName);
    }
  }

  await db.$transaction(async (tx) => {
    const importRow = await tx.estimateImport.create({
      data: {
        projectId,
        sourceKey: key,
        originalName: file.name,
        rowCount: parsed.lines.length,
        importedById: user.id,
      },
    });

    // Reset on replace: clear the project's existing estimate lines first.
    if (replace) await tx.estimateLineItem.deleteMany({ where: { projectId } });

    // Upsert cost codes for this project; build a code→id map.
    const codeMap = new Map<string, string>();
    for (const code of codes) {
      const name = nameByCode.get(code);
      const cc = await tx.costCode.upsert({
        where: { projectId_code: { projectId, code } },
        create: { projectId, code, name: name ?? code },
        update: name ? { name } : {}, // only overwrite the name if the sheet supplied one
      });
      codeMap.set(code, cc.id);
    }

    await tx.estimateLineItem.createMany({
      data: parsed.lines.map((l) => ({
        projectId,
        importId: importRow.id,
        costCodeId: l.costCode ? codeMap.get(l.costCode) ?? null : null,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitCostCents: l.unitCostCents,
        totalCents: l.totalCents,
        sortOrder: l.sortOrder,
      })),
    });
  });

  revalidatePath(`/projects/${projectId}/estimate`);
  return {
    ok: true,
    message: `${replace ? "Replaced the estimate —" : "Imported"} ${parsed.lines.length} line item(s) across ${codes.length} cost code(s).`,
    rowCount: parsed.lines.length,
    warnings: parsed.warnings,
  };
}

// Manually add a single estimate line (no Excel needed). Upserts the cost code.
export async function addEstimateLine(projectId: string, formData: FormData): Promise<ImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders edit the estimate");

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, message: "Description is required." };

  const code = String(formData.get("code") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim() || null;
  const quantity = Number(formData.get("quantity") ?? 1) || 1;
  const unitCostCents = dollarsToCents(String(formData.get("unitCost") ?? "0"));
  const totalCents = lineTotalCents(quantity, unitCostCents);

  let costCodeId: string | null = null;
  if (code) {
    const cc = await db.costCode.upsert({
      where: { projectId_code: { projectId, code } },
      create: { projectId, code, name: code },
      update: {},
    });
    costCodeId = cc.id;
  }

  const last = await db.estimateLineItem.findFirst({
    where: { projectId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  await db.estimateLineItem.create({
    data: {
      projectId,
      costCodeId,
      description,
      quantity,
      unit,
      unitCostCents,
      totalCents,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });

  revalidatePath(`/projects/${projectId}/estimate`);
  return { ok: true, message: `Added "${description}".` };
}

/** Every cost code on the job — the options when re-pointing a line. */
export async function listProjectCostCodes(projectId: string) {
  await assertProjectAccess(projectId);
  return db.costCode.findMany({
    where: { projectId },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
}

/**
 * Edit one estimate line in place.
 *
 * Until now the only way to change a single figure was to re-import the whole
 * spreadsheet with "replace" ticked — which meant every correction, however
 * small, went through a file. Fine when the estimate came from a workbook;
 * useless when a line was added by hand or a rate needs nudging.
 *
 * Changing the cost code is the useful part: it is how spend gets re-pointed
 * without touching the source documents at either end.
 */
export async function updateEstimateLine(
  projectId: string,
  lineId: string,
  formData: FormData,
): Promise<ImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders edit the estimate");

  const existing = await db.estimateLineItem.findFirst({
    where: { id: lineId, projectId },
    select: { id: true },
  });
  if (!existing) return { ok: false, message: "That line isn't on this job." };

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, message: "Description is required." };

  const quantity = Number(formData.get("quantity") ?? 1) || 1;
  const unit = String(formData.get("unit") ?? "").trim() || null;
  const unitCostCents = dollarsToCents(String(formData.get("unitCost") ?? "0"));

  // An empty cost code is allowed and means "unallocated" — the same thing an
  // imported line with a blank Cost Code column means.
  const costCodeId = String(formData.get("costCodeId") ?? "").trim() || null;
  if (costCodeId) {
    const cc = await db.costCode.findFirst({ where: { id: costCodeId, projectId }, select: { id: true } });
    if (!cc) return { ok: false, message: "That cost code isn't on this job." };
  }

  await db.estimateLineItem.update({
    where: { id: lineId },
    data: {
      description,
      quantity,
      unit,
      unitCostCents,
      totalCents: lineTotalCents(quantity, unitCostCents),
      costCodeId,
    },
  });

  revalidatePath(`/projects/${projectId}/estimate`);
  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, message: `Updated "${description}".` };
}

/**
 * Delete one estimate line, and tidy up behind it.
 *
 * A cost code left with no estimate lines still shows as an empty row on the
 * Budget page forever, because nothing ever removes a code. So if this was the
 * last line on its code, the code goes too — but only when nothing else is
 * holding on to it: no spend posted, no variation pointing at it, and no alias
 * mapping a reconciliation name onto it. Any of those and the code stays,
 * because deleting it would strand real money.
 */
export async function deleteEstimateLine(projectId: string, lineId: string): Promise<ImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders edit the estimate");

  const line = await db.estimateLineItem.findFirst({
    where: { id: lineId, projectId },
    select: { id: true, description: true, costCodeId: true },
  });
  if (!line) return { ok: false, message: "That line isn't on this job." };

  await db.estimateLineItem.delete({ where: { id: line.id } });

  let tidied = "";
  if (line.costCodeId) {
    const [lines, actuals, variations, variationLines, aliases] = await Promise.all([
      db.estimateLineItem.count({ where: { costCodeId: line.costCodeId } }),
      db.costActual.count({ where: { costCodeId: line.costCodeId } }),
      db.variation.count({ where: { costCodeId: line.costCodeId } }),
      db.variationLineItem.count({ where: { costCodeId: line.costCodeId } }),
      db.costCodeAlias.count({ where: { costCodeId: line.costCodeId } }),
    ]);
    if (lines === 0 && actuals === 0 && variations === 0 && variationLines === 0 && aliases === 0) {
      const cc = await db.costCode.delete({ where: { id: line.costCodeId } });
      tidied = ` Cost code ${cc.code} ${cc.name} had nothing left on it and was removed.`;
    }
  }

  revalidatePath(`/projects/${projectId}/estimate`);
  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, message: `Deleted "${line.description}".${tidied}` };
}
