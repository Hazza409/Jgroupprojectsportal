"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ClaimStatus, Role, ClaimPaymentStatus } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
import { dollarsToCents, formatCents } from "@/lib/money";
import { notifyBuilders, notifyProject } from "@/lib/email";
import { listReconTabs, parseReconciliationBuffer } from "@/lib/excel/parseReconciliation";
import { getCompany, companyShortName, getProjectRates } from "@/lib/company";
import { fmtDateShort } from "@/lib/dates";
import { materializeClaimActuals, matchCostCodeId, projectCodeRefs, claimHeadlineCents } from "@/lib/claims";
import { recordDecision, contentFingerprint, hasAcknowledged, AUTHORITY_STATEMENT, ACKNOWLEDGEMENT_STATEMENT } from "@/lib/audit";
import { DecisionAction, DecisionSubject } from "@prisma/client";

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
  const reconCompany = await getProjectRates(projectId);
  const parsed = parseReconciliationBuffer(buf, reconCompany.marginPercent, reconCompany.gstPercent);
  if (parsed.budgetOverview.length === 0 && parsed.supplierLines.length === 0) {
    return { ok: false, message: parsed.warnings[0] ?? "Could not read the reconciliation sheet." };
  }

  // Claim periods must run forward: claim #4 cannot cover an earlier period
  // than claim #3 (Jake §6). Checked BEFORE anything is written, so a
  // mis-numbered sheet can't corrupt the sequence.
  if (parsed.meta.date) {
    const prior = await db.progressClaim.findFirst({
      where: { projectId, claimNumber: { lt: claim.claimNumber }, periodEnd: { not: null } },
      orderBy: { claimNumber: "desc" },
      select: { claimNumber: true, periodEnd: true, periodLabel: true },
    });
    if (prior?.periodEnd && parsed.meta.date < prior.periodEnd) {
      return {
        ok: false,
        message:
          `Period out of sequence: this sheet covers ${fmtDateShort(parsed.meta.date)}, which is earlier than ` +
          `claim #${prior.claimNumber} (${prior.periodLabel ?? fmtDateShort(prior.periodEnd)}). ` +
          `Claim periods must run forward — check you've uploaded the right sheet.`,
      };
    }
  }

  // Store the source file (audit trail).
  const store = await storage();
  const key = buildKey({ projectId, category: "claims", originalName: `${Date.now()}-${file.name}` });
  await store.put({ key, body: buf, contentType: file.type || "application/octet-stream" });

  // Match budget-overview rows to cost codes — fuzzy (case/spacing/punctuation
  // and small-typo tolerant), so "Fire Places"/"Fireplaces" etc. link up.
  const codes = await projectCodeRefs(projectId);

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
        depositCreditCents: parsed.depositCents,
        depositLabel: parsed.depositLabel,
      },
    });

    if (parsed.budgetOverview.length > 0) {
      await tx.claimLineItem.createMany({
        data: parsed.budgetOverview.map((b) => ({
          claimId,
          costCodeId: matchCostCodeId(b.name, codes),
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

// Builder records a claim as ALREADY approved — for historical claims that
// were approved outside the portal before the project was added to the site.
// Skips the submit → client-approve flow, sends NO notifications, and posts
// the claim's costs to Cost to Complete exactly like a normal approval.
export async function recordClaimApproved(projectId: string, claimId: string) {
  await builderOnly(projectId);
  // Must have content — otherwise a stale totalCents would draw down the budget
  // while posting nothing to Cost to Complete.
  const claim = await db.progressClaim.findFirst({
    where: { id: claimId, projectId },
    select: { totalCents: true, _count: { select: { lines: true } } },
  });
  if (!claim || (claim._count.lines === 0 && claim.totalCents === 0)) {
    throw new Error("Add line items or import a reconciliation sheet before recording as approved");
  }
  const updated = await db.progressClaim.updateMany({
    where: { id: claimId, projectId, status: { in: [ClaimStatus.DRAFT, ClaimStatus.SUBMITTED] } },
    data: { status: ClaimStatus.APPROVED, approvedAt: new Date() },
  });
  if (updated.count === 0) return;
  await materializeClaimActuals(projectId, claimId);
  revalidatePath(`/projects/${projectId}/cost-to-complete`);
  revalidatePath(`/projects/${projectId}`);
  refresh(projectId, claimId);
}

// Builder re-opens a submitted or knocked-back claim so it can be edited and
// resubmitted (the recon re-import replaces its contents — that's the "replace").
export async function reopenClaim(projectId: string, claimId: string) {
  await builderOnly(projectId);
  await db.progressClaim.updateMany({
    where: { id: claimId, projectId, status: { in: [ClaimStatus.SUBMITTED, ClaimStatus.REJECTED] } },
    data: { status: ClaimStatus.DRAFT, submittedAt: null, approvedAt: null },
  });
  refresh(projectId, claimId);
}

// Builder deletes a claim outright (e.g. raised in error). Approved claims are
// protected — they're the financial record the client signed off on.
export async function deleteClaim(projectId: string, claimId: string) {
  await builderOnly(projectId);
  const claim = await db.progressClaim.findFirst({
    where: { id: claimId, projectId },
    include: { invoiceFiles: { select: { fileKey: true } } },
  });
  if (!claim) return;
  if (claim.status === ClaimStatus.APPROVED) {
    throw new Error("Approved claims can't be deleted — they're the record the client signed off on.");
  }
  // Best-effort cleanup of stored files; DB rows cascade with the claim.
  const store = await storage();
  const keys = [claim.reconSheetKey, claim.xeroInvoiceKey, ...claim.invoiceFiles.map((f) => f.fileKey)];
  await Promise.all(keys.filter((k): k is string => !!k).map((k) => store.delete(k).catch(() => {})));
  await db.progressClaim.delete({ where: { id: claim.id } });
  revalidatePath(`/projects/${projectId}/progress-claims`);
  redirect(`/projects/${projectId}/progress-claims`);
}

// Builder attaches supplier-invoice files (PDFs/images) to a claim — the
// transparency backup the client can open. Multiple files per upload.
export async function uploadClaimInvoices(projectId: string, claimId: string, formData: FormData) {
  await builderOnly(projectId);
  await db.progressClaim.findFirstOrThrow({ where: { id: claimId, projectId }, select: { id: true } });

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) throw new Error("No files uploaded");

  const store = await storage();
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const key = buildKey({ projectId, category: "claim-invoices", originalName: `${Date.now()}-${file.name}` });
    await store.put({ key, body: buf, contentType: file.type || "application/pdf" });
    await db.claimInvoiceFile.create({ data: { claimId, fileKey: key, originalName: file.name } });
  }
  refresh(projectId, claimId);
}

export async function deleteClaimInvoiceFile(projectId: string, claimId: string, fileId: string) {
  await builderOnly(projectId);
  const file = await db.claimInvoiceFile.findFirst({
    where: { id: fileId, claimId, claim: { projectId } },
  });
  if (!file) return;
  await (await storage()).delete(file.fileKey).catch(() => {});
  await db.claimInvoiceFile.delete({ where: { id: file.id } });
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

  // Tell the client(s) + PM there's a progress claim awaiting their review.
  const claim = await db.progressClaim.findUnique({
    where: { id: claimId },
    include: { project: { select: { name: true } }, lines: { select: { claimedAmountCents: true } } },
  });
  if (claim) {
    const total = claimHeadlineCents(claim, await getProjectRates(projectId));
    await notifyProject(
      projectId,
      `Progress claim for review — ${claim.project.name}`,
      [
        `${companyShortName(await getCompany())} has submitted Progress Claim #${claim.claimNumber} for your review on ${claim.project.name}.`,
        `Claim total: ${formatCents(total)}`,
        `Sign in to review and approve it.`,
      ],
      { excludeUserId: user.id },
    );
  }
  refresh(projectId, claimId);
}

// Client approves or rejects a submitted claim. Approving does NOT push to Xero —
// invoice push is a separate, guarded, human-triggered step (invoicePush.ts).
export async function decideClaim(projectId: string, claimId: string, approve: boolean) {
  const user = await assertProjectAccess(projectId);

  // Freeze the exact version being decided on, before the status changes.
  const before = await db.progressClaim.findFirst({
    where: { id: claimId, projectId, status: ClaimStatus.SUBMITTED },
    include: { lines: { orderBy: { id: "asc" }, select: { description: true, claimedAmountCents: true } } },
  });
  if (!before) throw new Error("Claim is not awaiting a decision");
  const decidedAmount = claimHeadlineCents(before, await getProjectRates(projectId));
  const versionHash = contentFingerprint({
    claimNumber: before.claimNumber,
    totalCents: before.totalCents,
    lines: before.lines,
  });

  const claim = await db.progressClaim.update({
    where: { id: claimId, projectId, status: ClaimStatus.SUBMITTED },
    data: approve
      ? { status: ClaimStatus.APPROVED, approvedAt: new Date() }
      : { status: ClaimStatus.REJECTED },
    include: { lines: { select: { claimedAmountCents: true } }, project: { select: { name: true } } },
  });

  // ── Evidence: immutable record of who approved exactly what, and when.
  await recordDecision({
    projectId,
    subjectType: DecisionSubject.CLAIM,
    subjectId: claimId,
    subjectRef: `Progress Claim #${before.claimNumber}`,
    subjectTitle: before.periodLabel,
    action: approve ? DecisionAction.APPROVED : DecisionAction.REJECTED,
    actor: user,
    amountCents: decidedAmount,
    versionHash,
    detail:
      user.role === Role.BUILDER
        ? "Recorded by J Group on the client's behalf (decision received outside the portal)."
        : approve
          ? AUTHORITY_STATEMENT
          : null,
  });

  if (approve) {
    // Post the claim's per-cost-code amounts into the cost feed so the
    // Cost to Complete "Current to Date" reflects this approval (idempotent).
    await materializeClaimActuals(projectId, claimId);
    revalidatePath(`/projects/${projectId}/cost-to-complete`);
    revalidatePath(`/projects/${projectId}`); // overview drawn-down

    // Headline = recon total (inc GST) when built from a sheet, else grossed line sum.
    const total = claimHeadlineCents(claim, await getProjectRates(projectId));
    await notifyBuilders(`Progress claim approved — ${claim.project.name}`, [
      `${user.name} (${user.role.toLowerCase()}) approved Claim #${claim.claimNumber} on ${claim.project.name}.`,
      `Approved amount: ${formatCents(total)}`,
      `Open the ${companyShortName(await getCompany())} dashboard — the Xero invoice push is a separate, manual step.`,
    ]);
  } else {
    // A rejection told nobody. The client could decline a claim worth
    // hundreds of thousands and the only trace was a status on a page no one
    // had reason to reload — the single most important thing to be told about
    // a claim, and it was the one event that sent nothing.
    const total = claimHeadlineCents(claim, await getProjectRates(projectId));
    await notifyBuilders(`Progress claim REJECTED — ${claim.project.name}`, [
      `${user.name} (${user.role.toLowerCase()}) rejected Claim #${claim.claimNumber} on ${claim.project.name}.`,
      `The claim was for ${formatCents(total)} (incl margin & GST).`,
      `It stays on the job as rejected. Speak to the client before re-issuing.`,
    ]);
  }
  refresh(projectId, claimId);
}

/**
 * Client acknowledges receipt of an issued claim (Jake §2). Acknowledgement is
 * RECEIPT, not approval — it proves the client saw the claim, nothing more.
 * Recorded once per user, immutably.
 */
export async function acknowledgeClaim(projectId: string, claimId: string) {
  const user = await assertProjectAccess(projectId);
  const claim = await db.progressClaim.findFirst({
    where: { id: claimId, projectId, status: { not: ClaimStatus.DRAFT } },
    select: { id: true, claimNumber: true, periodLabel: true, totalCents: true },
  });
  if (!claim) throw new Error("Claim not found");
  if (await hasAcknowledged(DecisionSubject.CLAIM, claimId, user.id)) return; // once only

  await recordDecision({
    projectId,
    subjectType: DecisionSubject.CLAIM,
    subjectId: claimId,
    subjectRef: `Progress Claim #${claim.claimNumber}`,
    subjectTitle: claim.periodLabel,
    action: DecisionAction.ACKNOWLEDGED,
    actor: user,
    amountCents: claim.totalCents || null,
    detail: ACKNOWLEDGEMENT_STATEMENT,
  });
  refresh(projectId, claimId);
}

/** Builder sets where a claim sits commercially (Jake §5). */
export async function setClaimPayment(projectId: string, claimId: string, formData: FormData) {
  await builderOnly(projectId);
  const raw = String(formData.get("paymentStatus") ?? "");
  const status = (["NOT_INVOICED", "INVOICED", "PAID"] as const).includes(raw as never)
    ? (raw as ClaimPaymentStatus)
    : ClaimPaymentStatus.NOT_INVOICED;
  const reference = String(formData.get("paymentReference") ?? "").trim() || null;

  const existing = await db.progressClaim.findFirst({
    where: { id: claimId, projectId },
    select: { invoicedAt: true, paidAt: true },
  });
  if (!existing) throw new Error("Claim not found");

  await db.progressClaim.update({
    where: { id: claimId },
    data: {
      paymentStatus: status,
      paymentReference: reference,
      // Stamp the first time each state is reached; don't overwrite history.
      invoicedAt: status === ClaimPaymentStatus.NOT_INVOICED ? null : (existing.invoicedAt ?? new Date()),
      paidAt: status === ClaimPaymentStatus.PAID ? (existing.paidAt ?? new Date()) : null,
    },
  });
  refresh(projectId, claimId);
}

/** Builder adds a labour line: hours by ROLE at an agreed rate (Jake §5). */
export async function addClaimLabour(projectId: string, claimId: string, formData: FormData) {
  await builderOnly(projectId);
  const claim = await db.progressClaim.findFirst({ where: { id: claimId, projectId }, select: { id: true } });
  if (!claim) throw new Error("Claim not found");

  const role = String(formData.get("role") ?? "").trim();
  if (!role) throw new Error("Role is required");
  const hours = Number(formData.get("hours") ?? 0) || 0;
  const rateCents = dollarsToCents(String(formData.get("rate") ?? "0"));
  // Money stays integer cents; hours may be fractional.
  const amountCents = Math.round(hours * rateCents);

  const last = await db.claimLabourEntry.findFirst({
    where: { claimId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  await db.claimLabourEntry.create({
    data: { claimId, role, hours, rateCents, amountCents, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  refresh(projectId, claimId);
}

export async function deleteClaimLabour(projectId: string, claimId: string, entryId: string) {
  await builderOnly(projectId);
  await db.claimLabourEntry.deleteMany({ where: { id: entryId, claim: { id: claimId, projectId } } });
  refresh(projectId, claimId);
}

// ── Claim history for a job brought on mid-build ───────────────
// A job that transfers in has already run for years, and its whole record
// lives in one reconciliation workbook — a tab per invoice. Importing them one
// at a time through the normal flow means four operations each; over 54
// invoices that is not a workflow, it is an afternoon of clicking.
//
// Three things this gets right that the one-at-a-time route cannot:
//
//  * Money comes from each month's CURRENT column, not the running To Date.
//    On a long sheet those disagree — a hand-maintained To Date drifts from
//    the movements above it — and the monthly figures are the ones that
//    reconcile to what was actually invoiced.
//  * Dates are resolved with the SEQUENCE as evidence. A date that goes
//    backwards against the previous invoice, where swapping day and month
//    fixes it, is a transposed date (Excel reading a typed d/m/y as m/d/y),
//    and nothing else can prove that.
//  * The source workbook is stored ONCE and each claim points at its tab,
//    rather than 54 copies of the same file.

export interface ClaimHistoryTab {
  invoiceNumber: number;
  tab: string;
  periodLabel: string | null;
  date: string | null;
  dateFixed: boolean;
  costCodes: number;
  suppliers: number;
  totalCents: number;
  exists: boolean;
}

export interface ClaimHistoryResult extends ReconImportResult {
  tabs?: ClaimHistoryTab[];
  totalCents?: number;
  imported?: number;
}

/** Day/month swapped, when the day could itself be a month. */
function swapDayMonth(d: Date): Date | null {
  const day = d.getDate();
  if (day < 1 || day > 12) return null;
  const s = new Date(d.getFullYear(), day - 1, d.getMonth() + 1);
  return Number.isNaN(s.getTime()) ? null : s;
}

/**
 * Parse every invoice tab, in invoice order, and repair dates that run
 * backwards. Progress claims are raised in sequence, so a date earlier than
 * the previous claim's is wrong by definition; if swapping day and month
 * makes it later, that is the answer.
 */
async function readHistory(buf: Buffer, marginPercent: number, gstPercent: number) {
  const tabs = listReconTabs(buf).filter((t) => t.invoiceNumber !== null) as { name: string; invoiceNumber: number }[];
  tabs.sort((a, b) => a.invoiceNumber - b.invoiceNumber);

  const parsed = tabs.map((t) => ({
    tab: t.name,
    invoiceNumber: t.invoiceNumber,
    p: parseReconciliationBuffer(buf, marginPercent, gstPercent, t.name),
    dateFixed: false,
  }));

  let previous: Date | null = null;
  for (const row of parsed) {
    const d = row.p.meta.date;
    if (d && previous && d <= previous) {
      const swapped = swapDayMonth(d);
      if (swapped && swapped > previous) {
        row.p.meta.date = swapped;
        row.dateFixed = true;
      }
    }
    if (row.p.meta.date) previous = row.p.meta.date;
  }
  return parsed;
}

export async function previewClaimHistory(projectId: string, formData: FormData): Promise<ClaimHistoryResult> {
  await builderOnly(projectId);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "No file uploaded." };
  if (!/\.xlsx?$/i.test(file.name)) return { ok: false, message: "Please upload the reconciliation .xlsx file." };

  const company = await getProjectRates(projectId);
  const rows = await readHistory(Buffer.from(await file.arrayBuffer()), company.marginPercent, company.gstPercent);
  if (rows.length === 0) return { ok: false, message: "No invoice tabs found in that workbook." };

  const existing = await db.progressClaim.findMany({ where: { projectId }, select: { claimNumber: true } });
  const taken = new Set(existing.map((c) => c.claimNumber));

  return {
    ok: true,
    message: `${rows.length} invoice tab(s) read.`,
    totalCents: rows.reduce((a, r) => a + r.p.totalCents, 0),
    tabs: rows.map((r) => ({
      invoiceNumber: r.invoiceNumber,
      tab: r.tab,
      periodLabel: r.p.meta.periodLabel,
      date: r.p.meta.date ? r.p.meta.date.toISOString().slice(0, 10) : null,
      dateFixed: r.dateFixed,
      costCodes: r.p.budgetOverview.filter((b) => b.currentCents !== 0).length,
      suppliers: r.p.supplierLines.length,
      totalCents: r.p.totalCents,
      exists: taken.has(r.invoiceNumber),
    })),
  };
}

export async function importClaimHistory(projectId: string, formData: FormData): Promise<ClaimHistoryResult> {
  const user = await builderOnly(projectId);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "No file uploaded." };
  if (!/\.xlsx?$/i.test(file.name)) return { ok: false, message: "Please upload the reconciliation .xlsx file." };

  // Up to and including this invoice. The CURRENT invoice is still being
  // built in the spreadsheet, so it is raised as a live claim rather than
  // carried in as history.
  const upTo = Number(formData.get("upTo"));
  if (!Number.isFinite(upTo) || upTo < 1) return { ok: false, message: "Choose the last invoice to bring in." };

  const buf = Buffer.from(await file.arrayBuffer());
  const company = await getProjectRates(projectId);
  const rows = (await readHistory(buf, company.marginPercent, company.gstPercent)).filter(
    (r) => r.invoiceNumber <= upTo,
  );
  if (rows.length === 0) return { ok: false, message: "No invoice tabs at or below that number." };

  const warnings: string[] = [];
  const codes = await projectCodeRefs(projectId);
  if (codes.length === 0) {
    return { ok: false, message: "Import the estimate first — claim lines are matched to its cost codes." };
  }

  // A carried-in opening position is the SAME money in aggregate form. Leaving
  // it alongside the claims would count every month twice, so it goes.
  const cleared = await db.costActual.deleteMany({
    where: { projectId, OR: [{ xeroSourceId: { startsWith: "opening:" } }, { xeroSourceId: { startsWith: "import:" } }] },
  });
  if (cleared.count > 0) {
    warnings.push(
      `Removed the carried-in opening position (${cleared.count} row(s)). The claims below now carry the ` +
        `spend instead — the same money, month by month rather than as one lump.`,
    );
  }

  // The workbook once, not once per claim.
  const store = await storage();
  const key = buildKey({ projectId, category: "claims", originalName: `${Date.now()}-${file.name}` });
  await store.put({ key, body: buf, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  let created = 0;
  let skipped = 0;
  let fixedDates = 0;
  let totalCents = 0;

  for (const row of rows) {
    const p = row.p;
    const exists = await db.progressClaim.findFirst({
      where: { projectId, claimNumber: row.invoiceNumber },
      select: { id: true },
    });
    if (exists) {
      skipped++;
      continue;
    }
    if (row.dateFixed) fixedDates++;

    const claim = await db.progressClaim.create({
      data: {
        projectId,
        claimNumber: row.invoiceNumber,
        status: ClaimStatus.APPROVED,
        periodEnd: p.meta.date ?? undefined,
        approvedAt: p.meta.date ?? undefined,
        submittedAt: p.meta.date ?? undefined,
        submittedById: user.id,
        periodLabel: p.meta.periodLabel,
        reconInvoiceRef: p.meta.invoiceRef,
        reconSheetKey: key,
        reconSheetName: `${file.name} — ${row.tab}`,
        labourCents: p.labourCents,
        costsCents: p.costsCents,
        marginPercent: p.marginPercent,
        marginCents: p.marginCents,
        subtotalCents: p.subtotalCents,
        gstCents: p.gstCents,
        // totalCents is the WORK done. A deposit repayment nets off the cash
        // the client pays, not the value of the work, so it is recorded beside
        // the claim rather than inside it.
        totalCents: p.totalCents,
        depositCreditCents: p.depositCents,
        depositLabel: p.depositLabel,
        // Money per cost code is this month's movement, NOT the running total.
        lines: {
          create: p.budgetOverview
            .filter((b) => b.currentCents !== 0)
            .map((b) => ({
              costCodeId: matchCostCodeId(b.name, codes),
              description: b.name,
              claimedAmountCents: b.currentCents,
              priorCents: b.priorCents,
              toDateCents: b.toDateCents,
            })),
        },
        reconLines: {
          create: p.supplierLines.map((l) => ({
            supplier: l.supplier,
            documentNumber: l.documentNumber,
            allocation: l.allocation,
            amountCents: l.amountCents,
          })),
        },
      },
    });
    created++;
    totalCents += p.totalCents;

    // Post this claim's lines into the cost feed, which is what makes spend
    // accumulate per cost code.
    await materializeClaimActuals(projectId, claim.id);

    await recordDecision({
      projectId,
      subjectType: DecisionSubject.CLAIM,
      subjectId: claim.id,
      subjectRef: `Progress Claim #${row.invoiceNumber}`,
      subjectTitle: p.meta.periodLabel ?? row.tab,
      action: DecisionAction.APPROVED,
      actor: user,
      amountCents: p.totalCents,
      occurredAt: p.meta.date ?? undefined,
      detail:
        `Historical claim carried in when this job was brought onto the dashboard — invoiced and settled ` +
        `outside the portal, recorded by ${user.name} on ${new Date().toLocaleDateString("en-AU", { dateStyle: "medium" })}. ` +
        `Source: ${file.name}, tab "${row.tab}"${p.meta.invoiceRef ? `, ${p.meta.invoiceRef}` : ""}.`,
    });
  }

  if (fixedDates > 0) {
    warnings.push(
      `${fixedDates} invoice date(s) ran backwards against the previous claim and were corrected by ` +
        `swapping day and month — Excel had read a typed d/m/y date month-first. Worth fixing in the sheet.`,
    );
  }
  if (skipped > 0) warnings.push(`${skipped} invoice(s) already existed as claims and were left alone.`);

  refresh(projectId);
  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}`);

  return {
    ok: created > 0,
    imported: created,
    totalCents,
    warnings,
    message: created
      ? `Carried in ${created} claim(s) up to invoice #${upTo}, ${formatCents(totalCents)} invoiced in total (inc margin & GST).`
      : `Nothing imported${skipped ? ` — all ${skipped} already existed.` : "."}`,
  };
}

/**
 * Set payment status across every APPROVED claim at once.
 *
 * A job carried in mid-build arrives with years of claims that were invoiced
 * and settled long ago, and every one of them defaults to "Not yet invoiced".
 * Left alone the client sees 54 approved claims that appear never to have been
 * billed — so this exists to correct the record in one move rather than 54.
 *
 * Dates come from each claim's OWN invoice date, not from today: the
 * reconciliation sheet records when each was raised, and stamping the import
 * date would put a false date on a payment record. Where a claim has no date
 * at all, it is skipped rather than guessed at, and reported.
 *
 * Only claims still sitting at NOT_INVOICED are touched, so a status already
 * set by hand is never overwritten.
 */
export async function setPaymentStatusForApproved(
  projectId: string,
  formData: FormData,
): Promise<ReconImportResult> {
  await builderOnly(projectId);

  const raw = String(formData.get("paymentStatus") ?? "");
  if (raw !== "INVOICED" && raw !== "PAID") {
    return { ok: false, message: "Choose whether these were invoiced or invoiced and paid." };
  }
  const status = raw as ClaimPaymentStatus;

  const claims = await db.progressClaim.findMany({
    where: { projectId, status: ClaimStatus.APPROVED, paymentStatus: ClaimPaymentStatus.NOT_INVOICED },
    select: { id: true, claimNumber: true, periodEnd: true, approvedAt: true },
    orderBy: { claimNumber: "asc" },
  });
  if (claims.length === 0) {
    return { ok: false, message: "No approved claims are sitting at “not yet invoiced”." };
  }

  const warnings: string[] = [];
  const undated: number[] = [];
  let updated = 0;

  for (const c of claims) {
    const when = c.periodEnd ?? c.approvedAt;
    if (!when) {
      undated.push(c.claimNumber);
      continue;
    }
    await db.progressClaim.update({
      where: { id: c.id },
      data: {
        paymentStatus: status,
        invoicedAt: when,
        paidAt: status === ClaimPaymentStatus.PAID ? when : null,
      },
    });
    updated++;
  }

  if (undated.length > 0) {
    warnings.push(
      `Claim(s) ${undated.join(", ")} have no invoice date on the reconciliation sheet, so there is nothing ` +
        `honest to stamp them with — they were left as they were. Set those by hand once you know the dates.`,
    );
  }
  if (status === ClaimPaymentStatus.PAID) {
    warnings.push(
      `Payment dates were taken as each claim's invoice date: the reconciliation sheet records when a claim ` +
        `was raised, not when it settled. Correct any that matter on the claim itself.`,
    );
  }

  refresh(projectId);
  revalidatePath(`/projects/${projectId}`);
  return {
    ok: true,
    warnings,
    message: `Marked ${updated} claim(s) as ${status === ClaimPaymentStatus.PAID ? "invoiced and paid" : "invoiced"}, each dated from its own invoice.`,
  };
}
