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

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "No file uploaded." };
  }
  if (!/\.(xlsx?|csv)$/i.test(file.name)) {
    return { ok: false, message: "Please upload an .xlsx, .xls or .csv file." };
  }

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

    // Upsert cost codes for this project; build a code→id map.
    const codeMap = new Map<string, string>();
    for (const code of codes) {
      const cc = await tx.costCode.upsert({
        where: { projectId_code: { projectId, code } },
        create: { projectId, code, name: code },
        update: {},
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
    message: `Imported ${parsed.lines.length} line item(s) across ${codes.length} cost code(s).`,
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
