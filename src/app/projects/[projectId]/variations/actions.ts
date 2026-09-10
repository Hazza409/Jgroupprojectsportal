"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { VariationStatus, Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";
import { storage, buildKey } from "@/lib/storage";
import { dollarsToCents, lineTotalCents, formatCents, inclMarginGst } from "@/lib/money";
import { companyShortName, getProjectRates } from "@/lib/company";
import { parseVariationsBuffer } from "@/lib/excel/parseVariations";
import { parseVariationPdfBuffer } from "@/lib/pdf/parseVariationPdf";
import { notifyBuilders, notifyProject } from "@/lib/email";
import { matchCostCodeId, projectCodeRefs } from "@/lib/claims";
import { recordDecision, contentFingerprint, AUTHORITY_STATEMENT } from "@/lib/audit";
import { DecisionAction, DecisionSubject } from "@prisma/client";

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

// Builder creates a variation with one or MORE line items. The form posts
// parallel arrays (lineDescription[], quantity[], unit[], unitCost[]) — one
// entry per row — which we zip into line items. Empty rows are skipped.
export async function createVariation(projectId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders create variations");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title required");

  const codes = await projectCodeRefs(projectId);
  const pickedCode = String(formData.get("costCodeId") ?? "") || null;
  // Variation-level code = explicit pick, else auto-match the title. Each line
  // falls back to this when its own description doesn't match a code.
  const varCode = pickedCode ?? matchCostCodeId(title, codes);

  // Zip the parallel row arrays into line items.
  const descs = formData.getAll("lineDescription").map((v) => String(v).trim());
  const qtys = formData.getAll("quantity").map((v) => String(v));
  const units = formData.getAll("unit").map((v) => String(v).trim());
  const costs = formData.getAll("unitCost").map((v) => String(v));
  const lines = descs
    .map((description, i) => {
      const qty = Number(qtys[i] ?? 1) || 1;
      const unitCostCents = dollarsToCents(costs[i] ?? "0");
      return { description, qty, unit: units[i] || null, unitCostCents, totalCents: lineTotalCents(qty, unitCostCents) };
    })
    // Keep rows that have either a description or a cost.
    .filter((l) => l.description || l.unitCostCents !== 0);
  // Always at least one line — fall back to the title as a single line.
  if (lines.length === 0) lines.push({ description: title, qty: 1, unit: null, unitCostCents: 0, totalCents: 0 });

  const totalCents = lines.reduce((a, l) => a + l.totalCents, 0);

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
      totalCents,
      costCodeId: varCode,
      lines: {
        create: lines.map((l) => ({
          description: l.description || title,
          quantity: l.qty,
          unit: l.unit,
          unitCostCents: l.unitCostCents,
          totalCents: l.totalCents,
          costCodeId: matchCostCodeId(l.description, codes) ?? varCode,
        })),
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
    // Numbering: use the sheet's own VO number where it gives one, because
    // that is the reference the client and the paperwork use — renumbering a
    // signed "VO 1025" to "#1" breaks the link between the portal and the
    // documents. Fall back to sequential only for rows with no number, and
    // skip a number already taken rather than colliding on
    // @@unique([projectId, variationNumber]). One create at a time, no race.
    let next = (last?.variationNumber ?? 0) + 1;
    const used = new Set(
      (await tx.variation.findMany({ where: { projectId }, select: { variationNumber: true } })).map(
        (v) => v.variationNumber,
      ),
    );
    for (const v of parsed.variations) {
      let number: number;
      if (v.number !== null && Number.isInteger(v.number) && v.number > 0 && !used.has(v.number)) {
        number = v.number;
      } else {
        while (used.has(next)) next++;
        number = next;
        if (v.number !== null && used.has(v.number)) {
          parsed.warnings.push(`VO ${v.number} is already on this job — "${v.title}" imported as #${number} instead.`);
        }
      }
      used.add(number);

      // Variation-level code = title match (the per-line default); each line
      // then matches its own description, falling back to the variation code.
      const varCode = matchCostCodeId(v.title, codes);
      await tx.variation.create({
        data: {
          projectId,
          variationNumber: number,
          title: v.title,
          description: v.description,
          status: v.status,
          totalCents: v.totalCents,
          // The date the client actually approved, where the sheet gives one.
          // Falling back to today would put a false date on a contract record
          // for anything approved before it was typed in.
          approvedAt: v.status === VariationStatus.APPROVED ? (v.approvedOn ?? new Date()) : null,
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

// ── Variation PDFs ────────────────────────────────────────────
// The signed variation document is the record the client actually holds, and
// a job that transfers in mid-build arrives as a folder of them. Reading them
// directly keeps three things that retyping loses: the variation NUMBER the
// client knows it by ("V-01025", not "#4"), the date on the document, and the
// document itself as the evidence behind the figure.

export interface PdfVariationPreview {
  file: string;
  reference: string | null;
  number: number | null;
  title: string;
  date: string | null; // ISO, for the form's date input
  lineCount: number;
  /** Base, ex margin and ex GST — what gets stored. */
  totalCents: number;
  /** Inc margin + GST — what the document shows the client. */
  clientTotalCents: number;
  /** Already on the job (same number) — importing again would collide. */
  existing: boolean;
  warnings: string[];
}

export interface PdfImportResult extends ImportResult {
  previews?: PdfVariationPreview[];
}

async function readVariationPdfs(formData: FormData, marginPercent: number) {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const parsed: { file: File; v: Awaited<ReturnType<typeof parseVariationPdfBuffer>>; buf: Buffer }[] = [];
  for (const file of files) {
    if (!/\.pdf$/i.test(file.name)) continue;
    const buf = Buffer.from(await file.arrayBuffer());
    parsed.push({ file, buf, v: await parseVariationPdfBuffer(buf, file.name, marginPercent) });
  }
  return parsed;
}

/** Parse without writing anything, so the builder can check before committing. */
export async function previewVariationPdfs(projectId: string, formData: FormData): Promise<PdfImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders import variations");

  const company = await getProjectRates(projectId);
  const parsed = await readVariationPdfs(formData, company.marginPercent);
  if (parsed.length === 0) return { ok: false, message: "No PDF files uploaded." };

  const numbers = parsed.map((p) => p.v.number).filter((n): n is number => n !== null);
  const clash = numbers.length
    ? await db.variation.findMany({
        where: { projectId, variationNumber: { in: numbers } },
        select: { variationNumber: true },
      })
    : [];
  const taken = new Set(clash.map((c) => c.variationNumber));

  return {
    ok: true,
    message: `Read ${parsed.length} variation document(s).`,
    previews: parsed
      .map(({ file, v }) => ({
        file: file.name,
        reference: v.reference,
        number: v.number,
        title: v.title,
        date: v.date ? v.date.toISOString().slice(0, 10) : null,
        lineCount: v.lines.length,
        totalCents: v.totalCents,
        clientTotalCents: inclMarginGst(v.totalCents, company),
        existing: v.number !== null && taken.has(v.number),
        warnings: v.warnings,
      }))
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
  };
}

/**
 * Create the variations. Approval is taken from the form, not guessed from the
 * document — the signature blocks on these are blank even for variations the
 * client has agreed to, so only the builder can say which are live.
 *
 * An approved one is stamped with the date it was ACTUALLY approved, and the
 * Decision Register says plainly that it was carried in at onboarding rather
 * than decided in the portal. Stamping today's date on a 2025 approval would
 * put a false date on a contract record.
 */
export async function commitVariationPdfs(projectId: string, formData: FormData): Promise<PdfImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders import variations");

  const company = await getProjectRates(projectId);
  const parsed = await readVariationPdfs(formData, company.marginPercent);
  if (parsed.length === 0) return { ok: false, message: "No PDF files uploaded." };

  const codes = await projectCodeRefs(projectId);
  const store = await storage();
  const warnings: string[] = [];
  let created = 0;
  let approved = 0;
  let skipped = 0;

  for (const { file, buf, v } of parsed) {
    warnings.push(...v.warnings);
    if (v.number === null) {
      warnings.push(`${file.name}: no "Variation No" on the document — skipped.`);
      skipped++;
      continue;
    }
    // Numbers are the client's reference and must not be reassigned, so a
    // collision is reported rather than renumbered around.
    const clash = await db.variation.findFirst({
      where: { projectId, variationNumber: v.number },
      select: { id: true },
    });
    if (clash) {
      warnings.push(`${v.reference ?? v.number}: already on this job — left alone.`);
      skipped++;
      continue;
    }

    const key = formData.get(`approved_${v.number}`) ? "1" : "";
    const isApproved = key === "1";
    const onRaw = String(formData.get(`approvedOn_${v.number}`) ?? "").trim();
    const approvedOn = isApproved ? (onRaw ? new Date(onRaw) : v.date) : null;
    if (isApproved && (!approvedOn || Number.isNaN(approvedOn.getTime()))) {
      warnings.push(`${v.reference ?? v.number}: marked approved but no valid approval date — imported as draft.`);
    }
    const liveApproval = isApproved && approvedOn instanceof Date && !Number.isNaN(approvedOn.getTime());

    // Store the source document first: it is the evidence for the figure, and
    // a variation without it is worth less than no variation at all.
    const storedKey = buildKey({ projectId, category: "variations", originalName: `${Date.now()}-${file.name}` });
    await store.put({ key: storedKey, body: buf, contentType: "application/pdf" });

    const varCode = matchCostCodeId(v.title, codes);
    const detailBits = [
      v.notes,
      v.reference ? `Source document: ${file.name} (${v.reference})` : `Source document: ${file.name}`,
      v.date ? `Dated ${v.date.toLocaleDateString("en-AU", { dateStyle: "medium" })}` : null,
    ].filter(Boolean);

    const variation = await db.variation.create({
      data: {
        projectId,
        variationNumber: v.number,
        title: v.title,
        description: detailBits.join(" — "),
        status: liveApproval ? VariationStatus.APPROVED : VariationStatus.DRAFT,
        approvedAt: liveApproval ? approvedOn : null,
        totalCents: v.totalCents,
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
      include: { lines: { orderBy: { id: "asc" }, select: { description: true, quantity: true, totalCents: true } } },
    });
    created++;

    if (liveApproval) {
      approved++;
      await recordDecision({
        projectId,
        subjectType: DecisionSubject.VARIATION,
        subjectId: variation.id,
        subjectRef: `Variation ${v.reference ?? `#${v.number}`}`,
        subjectTitle: v.title,
        action: DecisionAction.APPROVED,
        actor: user,
        amountCents: inclMarginGst(v.totalCents, company),
        versionHash: contentFingerprint({ title: v.title, totalCents: v.totalCents, lines: variation.lines }),
        // Dated when the client actually approved, not when it was typed in.
        // The register is a record of decisions, and this decision was made on
        // the date printed on the document.
        occurredAt: approvedOn!,
        detail:
          `Historical approval carried in when this job was brought onto the dashboard — approved outside ` +
          `the portal and recorded by ${user.name} on ${new Date().toLocaleDateString("en-AU", { dateStyle: "medium" })}. ` +
          `Source document: ${file.name}.`,
      });
    }
  }

  refresh(projectId);
  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}`);

  return {
    ok: created > 0,
    rowCount: created,
    warnings,
    message: created
      ? `Imported ${created} variation(s), ${approved} as approved${skipped ? `, ${skipped} skipped` : ""}.`
      : `Nothing imported${skipped ? ` — ${skipped} skipped.` : "."}`,
  };
}

/**
 * Builder deletes a variation.
 *
 * What can go depends entirely on whether a client has been involved:
 *
 *   DRAFT      — internal workspace, never client-visible. Deleted outright;
 *                there is nothing to preserve and nothing to explain.
 *   SUBMITTED  — the client has been asked to decide. The variation goes, but
 *                a WITHDRAWN entry stays in the Decision Register, because
 *                "we put that to you and then pulled it" is a fact about the
 *                job and must survive the record it described.
 *   APPROVED   — refused. A client's approval and its date are a contract
 *   REJECTED     record. Deleting one would erase evidence of an authorisation
 *                (or a refusal) that money and scope now rest on. The way to
 *                undo an approved variation is another variation reversing it,
 *                which leaves both halves visible — the same rule the
 *                re-importer follows when it refuses to wipe approved rows.
 */
export async function deleteVariation(projectId: string, variationId: string): Promise<ImportResult> {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders delete variations");

  const v = await db.variation.findFirst({
    where: { id: variationId, projectId },
    include: { lines: { orderBy: { id: "asc" }, select: { description: true, quantity: true, totalCents: true } } },
  });
  if (!v) return { ok: false, message: "Variation not found." };

  if (v.status === VariationStatus.APPROVED || v.status === VariationStatus.REJECTED) {
    const decided = v.status === VariationStatus.APPROVED ? "approved" : "rejected";
    return {
      ok: false,
      message:
        `Variation #${v.variationNumber} has been ${decided} by the client, so it can't be deleted — the ` +
        `decision and its date are part of the contract record. To reverse it, raise a new variation that ` +
        `credits this one back, so both sides stay visible.`,
    };
  }

  const company = await getProjectRates(projectId);

  // Evidence BEFORE the row goes: once deleted there is nothing left to
  // describe it, so the register entry has to carry the detail itself.
  if (v.status === VariationStatus.SUBMITTED) {
    await recordDecision({
      projectId,
      subjectType: DecisionSubject.VARIATION,
      subjectId: variationId,
      subjectRef: `Variation #${v.variationNumber}`,
      subjectTitle: v.title,
      action: DecisionAction.WITHDRAWN,
      actor: user,
      amountCents: inclMarginGst(v.totalCents, company),
      versionHash: contentFingerprint({ title: v.title, totalCents: v.totalCents, lines: v.lines }),
      detail:
        `Withdrawn and deleted by ${user.name} while awaiting the client's decision. ` +
        `It was with the client at ${formatCents(inclMarginGst(v.totalCents, company))} (incl margin & GST).`,
    });
  }

  await db.variation.delete({ where: { id: variationId } });

  refresh(projectId);
  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}`);

  return {
    ok: true,
    message:
      v.status === VariationStatus.SUBMITTED
        ? `Variation #${v.variationNumber} deleted. The withdrawal is recorded in the Decision Register.`
        : `Variation #${v.variationNumber} deleted.`,
  };
}

// Keep the cached variation.totalCents in step with its line items.
async function recomputeVariationTotal(variationId: string) {
  const lines = await db.variationLineItem.findMany({ where: { variationId }, select: { totalCents: true } });
  const totalCents = lines.reduce((a, l) => a + l.totalCents, 0);
  await db.variation.update({ where: { id: variationId }, data: { totalCents } });
}

// Save the line grid: cost-code allocation and each line's description box.
// Both are allowed at any status (descriptions are informational and clarify
// scope for the client; cost codes drive the Cost to Complete "Variations"
// column even after approval). Amounts and adding/removing lines stay draft-
// only (see add/deleteVariationLine). The form carries one `code_<lineId>` and
// one `desc_<lineId>` per line; ids from the form are validated against the DB.
export async function saveVariationLines(projectId: string, variationId: string, formData: FormData) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders edit variations");

  const variation = await db.variation.findFirst({ where: { id: variationId, projectId }, select: { id: true } });
  if (!variation) throw new Error("Variation not found");

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
    const desc = String(formData.get(`desc_${lineId}`) ?? "").trim();
    if (desc) data.description = desc; // keep the existing description if left blank
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
    const company = await getProjectRates(projectId);
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

  // Capture the EXACT version being decided on, before the status changes, so
  // the ledger proves what was in front of the client when they clicked.
  const before = await db.variation.findFirst({
    where: { id: variationId, projectId, status: VariationStatus.SUBMITTED },
    include: { lines: { orderBy: { id: "asc" }, select: { description: true, quantity: true, totalCents: true } } },
  });
  if (!before) throw new Error("Variation is not awaiting a decision");
  const company = await getProjectRates(projectId);
  const approvedAmount = inclMarginGst(before.totalCents, company);
  const versionHash = contentFingerprint({
    title: before.title,
    totalCents: before.totalCents,
    lines: before.lines,
  });

  await db.variation.update({
    where: { id: variationId, projectId, status: VariationStatus.SUBMITTED },
    data: approve
      ? { status: VariationStatus.APPROVED, approvedAt: new Date() }
      : { status: VariationStatus.REJECTED },
  });

  // ── Evidence: append an immutable record of this decision (Jake §2).
  await recordDecision({
    projectId,
    subjectType: DecisionSubject.VARIATION,
    subjectId: variationId,
    subjectRef: `Variation #${before.variationNumber}`,
    subjectTitle: before.title,
    action: approve ? DecisionAction.APPROVED : DecisionAction.REJECTED,
    actor: user,
    amountCents: approvedAmount,
    versionHash,
    detail:
      user.role === Role.BUILDER
        ? "Recorded by J Group on the client's behalf (decision received outside the portal)."
        : approve
          ? AUTHORITY_STATEMENT
          : null,
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
