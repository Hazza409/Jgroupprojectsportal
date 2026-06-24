"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { VariationStatus, Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
import { dollarsToCents, lineTotalCents, formatCents, inclMarginGst } from "@/lib/money";
import { parseVariationsBuffer } from "@/lib/excel/parseVariations";
import { notifyBuilders, notifyProject } from "@/lib/email";

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

  await db.variation.create({
    data: {
      projectId,
      variationNumber: (last?.variationNumber ?? 0) + 1,
      title,
      description: String(formData.get("description") ?? "") || null,
      status: VariationStatus.DRAFT,
      totalCents: total,
      lines: {
        create: [
          {
            description: lineDesc,
            quantity: qty,
            unit: String(formData.get("unit") ?? "") || null,
            unitCostCents,
            totalCents: total,
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

  await db.$transaction(async (tx) => {
    const last = await tx.variation.findFirst({
      where: { projectId },
      orderBy: { variationNumber: "desc" },
      select: { variationNumber: true },
    });
    // Allocate numbers sequentially — @@unique([projectId, variationNumber])
    // means we must NOT race; create one variation at a time inside the tx.
    let next = (last?.variationNumber ?? 0) + 1;
    for (const v of parsed.variations) {
      await tx.variation.create({
        data: {
          projectId,
          variationNumber: next++,
          title: v.title,
          description: v.description,
          status: v.status,
          totalCents: v.totalCents,
          approvedAt: v.status === VariationStatus.APPROVED ? new Date() : null,
          lines: {
            create: v.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unitCostCents: l.unitCostCents,
              totalCents: l.totalCents,
            })),
          },
        },
      });
    }
  });

  refresh(projectId);
  return {
    ok: true,
    message: `Imported ${parsed.variations.length} variation(s).`,
    rowCount: parsed.variations.length,
    warnings: parsed.warnings,
  };
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
    await notifyProject(
      projectId,
      `Variation for approval — ${v.project.name}`,
      [
        `J Group has submitted a variation for your approval on ${v.project.name}.`,
        `VO #${v.variationNumber}: ${v.title}`,
        `Amount: ${formatCents(inclMarginGst(v.totalCents))} (incl margin & GST)`,
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
      await notifyBuilders(
        `Variation approved — ${v.project.name}`,
        [
          `${user.name} (${user.role.toLowerCase()}) approved a variation on ${v.project.name}.`,
          `VO #${v.variationNumber}: ${v.title}`,
          `Approved amount: ${formatCents(inclMarginGst(v.totalCents))} (incl margin & GST)`,
          `Open the J Group dashboard to action it.`,
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
