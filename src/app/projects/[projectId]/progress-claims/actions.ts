"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ClaimStatus, Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
import { dollarsToCents, formatCents, sumCents } from "@/lib/money";
import { notifyBuilders } from "@/lib/email";
import { parseReconciliationBuffer } from "@/lib/excel/parseReconciliation";

export interface ReconImportResult {
  ok: boolean;
  message: string;
  warnings?: string[];
}

function refresh(projectId: string, claimId?: string) {
  revalidatePath(`/projects/${projectId}/progress-claims`);
  if (claimId) revalidatePath(`/projects/${projectId}/progress-claims/${claimId}`);
}

async function builderOnly(projectId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Builder action only");
  return user;
}

// Builder creates a draft claim (auto-incrementing claim number per project).
export async function createClaim(projectId: string) {
  const user = await builderOnly(projectId);
  const last = await db.progressClaim.findFirst({
    where: { projectId },
    orderBy: { claimNumber: "desc" },
    select: { claimNumber: true },
  });
  const claim = await db.progressClaim.create({
    data: {
      projectId,
      claimNumber: (last?.claimNumber ?? 0) + 1,
      status: ClaimStatus.DRAFT,
      submittedById: user.id,
    },
  });
  refresh(projectId, claim.id);
  redirect(`/projects/${projectId}/progress-claims/${claim.id}`);
}

// Builder adds a claim line (cost code, % complete, amount claimed this period).
export async function addClaimLine(projectId: string, claimId: string, formData: FormData) {
  await builderOnly(projectId);
  const claim = await db.progressClaim.findFirst({ where: { id: claimId, projectId } });
  if (!claim) throw new Error("Claim not found");
  if (claim.status !== ClaimStatus.DRAFT) throw new Error("Only draft claims can be edited");

  const costCodeId = String(formData.get("costCodeId") ?? "") || null;
  const description = String(formData.get("description") ?? "").trim();
  let pct = Number(formData.get("percentComplete") ?? 0) || 0;
  pct = Math.max(0, Math.min(100, pct));
  const claimedAmountCents = dollarsToCents(String(formData.get("claimedAmount") ?? "0"));

  // Default the description from the cost code if left blank.
  let desc = description;
  if (!desc && costCodeId) {
    const cc = await db.costCode.findFirst({ where: { id: costCodeId, projectId }, select: { name: true } });
    desc = cc?.name ?? "Line item";
  }
  if (!desc) desc = "Line item";

  await db.claimLineItem.create({
    data: { claimId, costCodeId, description: desc, percentComplete: pct, claimedAmountCents },
  });
  refresh(projectId, claimId);
}

// Pre-populate one line per cost code so the builder just fills in amounts.
export async function generateClaimLines(projectId: string, claimId: string) {
  await builderOnly(projectId);
  const claim = await db.progressClaim.findFirst({ where: { id: claimId, projectId } });
  if (!claim || claim.status !== ClaimStatus.DRAFT) throw new Error("Only draft claims can be generated");

  const [codes, existing] = await Promise.all([
    db.costCode.findMany({ where: { projectId }, orderBy: { code: "asc" } }),
    db.claimLineItem.findMany({ where: { claimId }, select: { costCodeId: true } }),
  ]);
  const have = new Set(existing.map((l) => l.costCodeId));
  const toCreate = codes.filter((cc) => !have.has(cc.id));
  if (toCreate.length > 0) {
    await db.claimLineItem.createMany({
      data: toCreate.map((cc) => ({
        claimId,
        costCodeId: cc.id,
        description: cc.name,
        percentComplete: 0,
        claimedAmountCents: 0,
      })),
    });
  }
  refresh(projectId, claimId);
}

export async function deleteClaimLine(projectId: string, claimId: string, lineId: string) {
  await builderOnly(projectId);
  const claim = await db.progressClaim.findFirst({ where: { id: claimId, projectId } });
  if (!claim || claim.status !== ClaimStatus.DRAFT) return;
  await db.claimLineItem.deleteMany({ where: { id: lineId, claimId } });
  refresh(projectId, claimId);
}

// Builder uploads the reconciliation sheet — the SOURCE OF TRUTH for the claim.
// Parses it and (replace mode) rebuilds the claim's line items, supplier backup,
// and summary (labour + costs + margin + GST) to match the sheet exactly.
export async function importReconSheet(
  projectId: string,
  claimId: string,
  formData: FormData,
): Promise<ReconImportResult> {
  await builderOnly(projectId);
  const claim = await db.progressClaim.findFirst({ where: { id: claimId, projectId } });
  if (!claim) return { ok: false, message: "Claim not found." };
  if (claim.status !== ClaimStatus.DRAFT) return { ok: false, message: "Only draft claims can be rebuilt from a sheet." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "No file uploaded." };
  if (!/\.xlsx?$/i.test(file.name)) return { ok: false, message: "Please upload the reconciliation .xlsx file." };

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseReconciliationBuffer(buf);
  if (parsed.budgetOverview.length === 0 && parsed.supplierLines.length === 0) {
    return { ok: false, message: parsed.warnings[0] ?? "Could not read the reconciliation sheet." };
  }

  // Store the source file (audit trail).
  const store = await storage();
  const key = buildKey({ projectId, category: "claims", originalName: `${Date.now()}-${file.name}` });
  await store.put({ key, body: buf, contentType: file.type || "application/octet-stream" });

  // Match budget-overview rows to cost codes by name (best effort).
  const codes = await db.costCode.findMany({ where: { projectId }, select: { id: true, name: true } });
  const byName = new Map(codes.map((c) => [c.name.trim().toLowerCase(), c.id]));

  await db.$transaction(async (tx) => {
    // Replace mode — the sheet is the source of truth.
    await tx.claimLineItem.deleteMany({ where: { claimId } });
    await tx.claimReconLine.deleteMany({ where: { claimId } });

    await tx.progressClaim.update({
      where: { id: claimId },
      data: {
        reconSheetKey: key,
        reconSheetName: file.name,
        periodLabel: parsed.meta.periodLabel,
        reconInvoiceRef: parsed.meta.invoiceRef,
        periodEnd: parsed.meta.date ?? undefined,
        labourCents: parsed.labourCents,
        costsCents: parsed.costsCents,
        marginPercent: parsed.marginPercent,
        marginCents: parsed.marginCents,
        subtotalCents: parsed.subtotalCents,
        gstCents: parsed.gstCents,
        totalCents: parsed.totalCents,
      },
    });

    if (parsed.budgetOverview.length > 0) {
      await tx.claimLineItem.createMany({
        data: parsed.budgetOverview.map((b) => ({
          claimId,
          costCodeId: byName.get(b.name.trim().toLowerCase()) ?? null,
          description: b.name,
          claimedAmountCents: b.currentCents,
          priorCents: b.priorCents,
          toDateCents: b.toDateCents,
        })),
      });
    }
    if (parsed.supplierLines.length > 0) {
      await tx.claimReconLine.createMany({
        data: parsed.supplierLines.map((l) => ({
          claimId,
          supplier: l.supplier,
          documentNumber: l.documentNumber,
          allocation: l.allocation,
          amountCents: l.amountCents,
        })),
      });
    }
  });

  refresh(projectId, claimId);
  return {
    ok: true,
    message: `Built claim from ${parsed.meta.invoiceRef ?? "sheet"}: ${parsed.budgetOverview.length} cost codes, ${parsed.supplierLines.length} supplier invoices.`,
    warnings: parsed.warnings,
  };
}

// Builder edits the "last two weeks" narrative shown to the client.
export async function updateNarrative(projectId: string, claimId: string, formData: FormData) {
  await builderOnly(projectId);
  const narrative = String(formData.get("narrative") ?? "").trim() || null;
  await db.progressClaim.updateMany({ where: { id: claimId, projectId }, data: { narrative } });
  refresh(projectId, claimId);
}

// Builder uploads the Xero-generated tax invoice (PDF) with J Group payment
// details — the document the client pays from. Allowed at any status.
export async function uploadXeroInvoice(projectId: string, claimId: string, formData: FormData) {
  await builderOnly(projectId);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("No file uploaded");

  const buf = Buffer.from(await file.arrayBuffer());
  const store = await storage();
  const key = buildKey({ projectId, category: "invoices", originalName: `${Date.now()}-${file.name}` });
  await store.put({ key, body: buf, contentType: file.type || "application/pdf" });
  await db.progressClaim.updateMany({
    where: { id: claimId, projectId },
    data: { xeroInvoiceKey: key, xeroInvoiceName: file.name },
  });
  refresh(projectId, claimId);
}

// Builder submits a draft for client approval (must have at least one line).
export async function submitClaim(projectId: string, claimId: string) {
  const user = await builderOnly(projectId);
  const lineCount = await db.claimLineItem.count({ where: { claimId } });
  if (lineCount === 0) throw new Error("Add at least one line item before submitting");

  await db.progressClaim.update({
    where: { id: claimId, projectId, status: ClaimStatus.DRAFT },
    data: { status: ClaimStatus.SUBMITTED, submittedById: user.id, submittedAt: new Date() },
  });
  refresh(projectId, claimId);
}

// Client approves or rejects a submitted claim. Approving does NOT push to Xero —
// invoice push is a separate, guarded, human-triggered step (invoicePush.ts).
export async function decideClaim(projectId: string, claimId: string, approve: boolean) {
  const user = await assertProjectAccess(projectId);
  const claim = await db.progressClaim.update({
    where: { id: claimId, projectId, status: ClaimStatus.SUBMITTED },
    data: approve
      ? { status: ClaimStatus.APPROVED, approvedAt: new Date() }
      : { status: ClaimStatus.REJECTED },
    include: { lines: { select: { claimedAmountCents: true } }, project: { select: { name: true } } },
  });

  if (approve) {
    // Headline = recon total (inc GST) when built from a sheet, else line sum.
    const total = claim.totalCents > 0 ? claim.totalCents : sumCents(claim.lines.map((l) => l.claimedAmountCents));
    await notifyBuilders(`Progress claim approved — ${claim.project.name}`, [
      `${user.name} (${user.role.toLowerCase()}) approved Claim #${claim.claimNumber} on ${claim.project.name}.`,
      `Approved amount: ${formatCents(total)}`,
      `Open the J Group dashboard — the Xero invoice push is a separate, manual step.`,
    ]);
  }
  refresh(projectId, claimId);
}
