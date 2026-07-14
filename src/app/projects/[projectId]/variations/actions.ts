"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { VariationStatus, Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
import { dollarsToCents, lineTotalCents, formatCents, inclMarginGst } from "@/lib/money";
import { getCompany, companyShortName } from "@/lib/company";
import { parseVariationsBuffer } from "@/lib/excel/parseVariations";
import { notifyBuilders, notifyProject } from "@/lib/email";
import { matchCostCodeId, projectCodeRefs } from "@/lib/claims";

export interface ImportResult {
  ok: boolean;
  message: string;
  rowCount?: number;
  warnings?: string[];
}

function refresh(projectId: string, variationId?: string) {
  revalidatePath(`/projects/${projectId}/variations`);
  if (variationId) revalidatePath(`/projects/${projectId}/variations/${variationId}`);
}

// Builder creates a variation with one or more line items. For the scaffold the
// form posts a single line (description + qty + unit cost); the total is derived.
export async function createVariation(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders create variations");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title required");
  const lineDesc = String(formData.get("lineDescription") ?? title).trim();
  const qty = Number(formData.get("quantity") ?? 1) || 1;
  const unitCostCents = dollarsToCents(String(formData.get("unitCost") ?? "0"));
  const total = lineTotalCents(qty, unitCostCents);

  const last = await db.variation.findFirst({
    where: { projectId },
    orderBy: { variationNumber: "desc" },
    select: { variationNumber: true },
  });

  // Assign to a cost code — an explicit pick from the form, else auto-match the
  // title. Set on BOTH the variation (default) and its line (the Cost to
  // Complete "Variations" column reads line-level, falling back to variation).
  const pickedCode = String(formData.get("costCodeId") ?? "") || null;
  const costCodeId = pickedCode ?? matchCostCodeId(title, await projectCodeRefs(projectId));

  await db.variation.create({
    data: {
      projectId,
      variationNumber: (last?.variationNumber ?? 0) + 1,
      title,
      description: String(formData.get("description") ?? "") || null,
      status: VariationStatus.DRAFT,
      totalCents: total,
      costCodeId,
      lines: {
        create: [
          {
            description: lineDesc,
            quantity: qty,
            unit: String(formData.get("unit") ?? "") || null,
            unitCostCents,
            totalCents: total,
            costCodeId,
          },
        ],
      },
    },
  });
  refresh(projectId);
  redirect(`/projects/${projectId}/variations`);
}

// Bulk-create variations from an uploaded .xlsx (same pattern as the estimate
// importer). Rows sharing a VO #/Title roll up into one variation with line
// items. Numbers are allocated sequentially from the project's current max so
// they never collide with existing variations. Imported variations land as the
// status given in the sheet (default DRAFT). Append-only — never deletes.
export async function importVariations(projectId: string, formData: FormData): Promise<ImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders import variations");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "No file uploaded." };
  }
  if (!/\.(xlsx?|csv)$/i.test(file.name)) {
    return { ok: false, message: "Please upload an .xlsx, .xls or .csv file." };
  }
  // Optional reset: when "Replace" is ticked, delete ALL existing variations
  // first (default off — variations are numbered, append-only records).
  const replace = !!formData.get("replace");

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseVariationsBuffer(buf);
  if (parsed.variations.length === 0) {
    return { ok: false, message: "No variations parsed.", warnings: parsed.warnings };
  }

  // Persist the original file (scoped key) before touching the DB.
  const store = await storage();
  const key = buildKey({
    projectId,
    category: "variations",
    originalName: `${Date.now()}-${file.name}`,
  });
  await store.put({
    key,
    body: buf,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const codes = await projectCodeRefs(projectId);
  await db.$transaction(async (tx) => {
    // Reset on replace: wipe existing variations first — but NEVER approved
    // ones. A client's approval (and its date) is a contract record; a re-import
    // must not silently delete it, forge a new approvedAt, or re-base the budget.
    if (replace) await tx.variation.deleteMany({ where: { projectId, status: { not: VariationStatus.APPROVED } } });
    const last = await tx.variation.findFirst({
      where: { projectId },
      orderBy: { variationNumber: "desc" },
      select: { variationNumber: true },
    });
    // Allocate numbers sequentially — @@unique([projectId, variationNumber])
    // means we must NOT race; create one variation at a time inside the tx.
    let next = (last?.variationNumber ?? 0) + 1;
    for (const v of parsed.variations) {
      // Variation-level code = title match (the per-line default); each line
      // then matches its own description, falling back to the variation code.
      const varCode = matchCostCodeId(v.title, codes);
      await tx.variation.create({
        data: {
          projectId,
          variationNumber: next++,
          title: v.title,
          description: v.description,
          status: v.status,
          totalCents: v.totalCents,
          approvedAt: v.status === VariationStatus.APPROVED ? new Date() : null,
          costCodeId: varCode,
          lines: {
            create: v.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unitCostCents: l.unitCostCents,
              totalCents: l.totalCents,
              costCodeId: matchCostCodeId(l.description, codes) ?? varCode,
            })),
          },
        },
      });
    }
  });

  refresh(projectId);
  return {
    ok: true,
    message: `${replace ? "Replaced all variations —" : "Imported"} ${parsed.variations.length} variation(s).`,
    rowCount: parsed.variations.length,
    warnings: parsed.warnings,
  };
}

// Keep the cached variation.totalCents in step with its line items.
async function recomputeVariationTotal(variationId: string) {
  const lines = await db.variationLineItem.findMany({ where: { variationId }, select: { totalCents: true } });
  const totalCents = lines.reduce((a, l) => a + l.totalCents, 0);
  await db.variation.update({ where: { id: variationId }, data: { totalCents } });
}

// Save the line grid: cost-code allocation (allowed anytime — drives the Cost
// to Complete "Variations" column even after approval) and line descriptions
// (DRAFT only — descriptions are part of the VO's scope). The form carries one
// `code_<lineId>` and one `desc_<lineId>` per line. All updates scoped to the
// project; ids from the form are validated against the DB.
export async function saveVariationLines(projectId: string, variationId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders edit variations");

  const variation = await db.variation.findFirst({ where: { id: variationId, projectId }, select: { status: true } });
  if (!variation) throw new Error("Variation not found");
  const isDraft = variation.status === VariationStatus.DRAFT;

  const lines = await db.variationLineItem.findMany({
    where: { variationId, variation: { projectId } },
    select: { id: true },
  });
  const lineIds = new Set(lines.map((l) => l.id));
  const codes = await db.costCode.findMany({ where: { projectId }, select: { id: true } });
  const codeIds = new Set(codes.map((c) => c.id));

  for (const lineId of lineIds) {
    const rawCode = String(formData.get(`code_${lineId}`) ?? "");
    const data: { costCodeId: string | null; description?: string } = {
      costCodeId: rawCode && codeIds.has(rawCode) ? rawCode : null,
    };
    // Only re-scope descriptions while the VO is still a draft.
    if (isDraft) {
      const desc = String(formData.get(`desc_${lineId}`) ?? "").trim();
      if (desc) data.description = desc;
    }
    await db.variationLineItem.update({ where: { id: lineId }, data });
  }
  revalidatePath(`/projects/${projectId}/variations/${variationId}`);
  revalidatePath(`/projects/${projectId}/cost-to-complete`);
}

// Add a line item to a DRAFT variation (with a description). Auto-matches a cost
// code from the description and recomputes the variation total.
export async function addVariationLine(projectId: string, variationId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders edit variations");
  const variation = await db.variation.findFirst({ where: { id: variationId, projectId }, select: { status: true } });
  if (!variation) throw new Error("Variation not found");
  if (variation.status !== VariationStatus.DRAFT) throw new Error("Only draft variations can be edited");

  const description = String(formData.get("description") ?? "").trim();
  if (!description) throw new Error("Line description is required");
  const qty = Number(formData.get("quantity") ?? 1) || 1;
  const unitCostCents = dollarsToCents(String(formData.get("unitCost") ?? "0"));
  const totalCents = lineTotalCents(qty, unitCostCents);
  const costCodeId = matchCostCodeId(description, await projectCodeRefs(projectId));

  await db.variationLineItem.create({
    data: {
      variationId,
      description,
      quantity: qty,
      unit: String(formData.get("unit") ?? "") || null,
      unitCostCents,
      totalCents,
      costCodeId,
    },
  });
  await recomputeVariationTotal(variationId);
  revalidatePath(`/projects/${projectId}/variations/${variationId}`);
  revalidatePath(`/projects/${projectId}/cost-to-complete`);
}

// Remove a line item from a DRAFT variation and recompute the total.
export async function deleteVariationLine(projectId: string, variationId: string, lineId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders edit variations");
  const line = await db.variationLineItem.findFirst({
    where: { id: lineId, variationId, variation: { projectId, status: VariationStatus.DRAFT } },
    select: { id: true },
  });
  if (!line) throw new Error("Line not found or variation not editable");
  await db.variationLineItem.delete({ where: { id: line.id } });
  await recomputeVariationTotal(variationId);
  revalidatePath(`/projects/${projectId}/variations/${variationId}`);
  revalidatePath(`/projects/${projectId}/cost-to-complete`);
}

export async function submitVariation(projectId: string, variationId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders submit variations");
  await db.variation.update({
    where: { id: variationId, projectId, status: VariationStatus.DRAFT },
    data: { status: VariationStatus.SUBMITTED },
  });

  // Tell the client(s) + PM there's a variation awaiting their approval.
  const v = await db.variation.findUnique({
    where: { id: variationId },
    include: { project: { select: { name: true } } },
  });
  if (v) {
    const company = await getCompany();
    await notifyProject(
      projectId,
      `Variation for approval — ${v.project.name}`,
      [
        `${companyShortName(company)} has submitted a variation for your approval on ${v.project.name}.`,
        `VO #${v.variationNumber}: ${v.title}`,
        `Amount: ${formatCents(inclMarginGst(v.totalCents, company))} (incl margin & GST)`,
        `Sign in to review and approve or decline it.`,
      ],
      { excludeUserId: user.id },
    );
  }
  refresh(projectId, variationId);
}

// Client approves/rejects a submitted variation.
export async function decideVariation(projectId: string, variationId: string, approve: boolean) {
  const user = await assertProjectAccess(projectId);
  await db.variation.update({
    where: { id: variationId, projectId, status: VariationStatus.SUBMITTED },
    data: approve
      ? { status: VariationStatus.APPROVED, approvedAt: new Date() }
      : { status: VariationStatus.REJECTED },
  });

  // Notify the J Group team when a variation is approved.
  if (approve) {
    const v = await db.variation.findUnique({
      where: { id: variationId },
      include: { project: { select: { name: true } } },
    });
    if (v) {
      const company = await getCompany();
      await notifyBuilders(
        `Variation approved — ${v.project.name}`,
        [
          `${user.name} (${user.role.toLowerCase()}) approved a variation on ${v.project.name}.`,
          `VO #${v.variationNumber}: ${v.title}`,
          `Approved amount: ${formatCents(inclMarginGst(v.totalCents, company))} (incl margin & GST)`,
          `Open the ${companyShortName(company)} dashboard to action it.`,
        ],
      );
    }
  }

  refresh(projectId, variationId);
}

// Builder attaches a subcontractor quote file to a variation.
export async function attachQuote(projectId: string, variationId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders attach quotes");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("No file uploaded");
  const vendorName = String(formData.get("vendorName") ?? "").trim() || "Unnamed vendor";
  const amountCents = dollarsToCents(String(formData.get("amount") ?? "0"));

  const buf = Buffer.from(await file.arrayBuffer());
  const store = await storage();
  const key = buildKey({
    projectId,
    category: "quotes",
    originalName: `${Date.now()}-${file.name}`,
  });
  await store.put({ key, body: buf, contentType: file.type || "application/octet-stream" });

  // Verify the variation belongs to this project before linking the quote.
  await db.variation.findFirstOrThrow({ where: { id: variationId, projectId } });
  await db.subcontractorQuote.create({
    data: { variationId, vendorName, amountCents, fileKey: key, originalName: file.name },
  });
  refresh(projectId, variationId);
}
