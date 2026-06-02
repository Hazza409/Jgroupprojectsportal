"use server";

import { revalidatePath } from "next/cache";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
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
  if (!/\.xlsx?$/i.test(file.name)) {
    return { ok: false, message: "Please upload an .xlsx or .xls file." };
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
