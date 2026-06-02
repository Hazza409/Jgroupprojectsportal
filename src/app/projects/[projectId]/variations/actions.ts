"use server";

import { revalidatePath } from "next/cache";
import { VariationStatus, Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
import { dollarsToCents, lineTotalCents, formatCents } from "@/lib/money";
import { notifyBuilders } from "@/lib/email";

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/variations`);
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
}

export async function submitVariation(projectId: string, variationId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders submit variations");
  await db.variation.update({
    where: { id: variationId, projectId, status: VariationStatus.DRAFT },
    data: { status: VariationStatus.SUBMITTED },
  });
  refresh(projectId);
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
          `Approved amount: ${formatCents(v.totalCents)}`,
          `Open the J Group dashboard to action it.`,
        ],
      );
    }
  }

  refresh(projectId);
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
  refresh(projectId);
}
