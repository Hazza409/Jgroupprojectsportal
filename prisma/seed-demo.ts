/**
 * Stand up a complete demo project from scratch, exercising EVERY module so the
 * builder→client flow can be verified end-to-end. Idempotent (wipes + recreates).
 *   npm run seed:demo
 */
import { PrismaClient, Role, VariationStatus, ClaimStatus, DesignDocKind, HandoverDocKind, ProjectPhase, CalendarEventKind, ServiceBookingStatus, QuoteRequestStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { storage, buildKey } from "../src/lib/storage";
import { inclMarginGst } from "../src/lib/money";

const db = new PrismaClient();
const c = (d: number) => Math.round(d * 100);
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
const PDF = Buffer.from("%PDF-1.4\n% demo document\n");
const PROJECT = "12 Ocean View, Freshwater";

async function putFile(projectId: string, category: string, name: string, body: Buffer, type: string) {
  const store = await storage();
  const key = buildKey({ projectId, category, originalName: `${Date.now()}-${name}` });
  await store.put({ key, body, contentType: type });
  return key;
}

async function main() {
  await db.project.deleteMany({ where: { name: PROJECT } });

  // ── Builder + a second project manager (Team feature) ──
  const builder = await db.user.findFirst({ where: { role: Role.BUILDER, email: "builder@jgroup.test" } });
  if (!builder) throw new Error("Run `npm run seed` first to create the base builder.");
  await db.user.upsert({
    where: { email: "priya@jgroup.test" },
    update: {},
    create: { email: "priya@jgroup.test", name: "Priya Shah", role: Role.BUILDER, passwordHash: await bcrypt.hash("manager123", 10) },
  });

  // ── Project (contract value shown inc margin & GST) ──
  const estimateBase = c(1_623_000);
  const project = await db.project.create({
    data: {
      name: PROJECT,
      address: "12 Ocean View Pde, Freshwater NSW 2096",
      clientName: "Sarah & Tom Whitfield",
      contractValueCents: inclMarginGst(estimateBase, { marginPercent: 12.5, gstPercent: 10 }),
      status: "ACTIVE",
      memberships: { create: [{ userId: builder.id, role: Role.BUILDER }] },
    },
  });
  const pid = project.id;

  // ── Client login, scoped to this project only ──
  const client = await db.user.upsert({
    where: { email: "whitfield@example.test" },
    update: {},
    create: { email: "whitfield@example.test", name: "Sarah Whitfield", role: Role.CLIENT, passwordHash: await bcrypt.hash("client123", 10) },
  });
  await db.projectMembership.create({ data: { userId: client.id, projectId: pid, role: Role.CLIENT } });

  // ── Cost codes + estimate + current costs (Cost to Complete) ──
  const codes: [string, string, number, number][] = [
    // code, name, estimate, current-to-date (base, ex margin/GST)
    ["1010", "Preliminaries", 85000, 85000],
    ["1015", "Concreting", 240000, 240000],
    ["1020", "Framing", 180000, 150000],
    ["1025", "Brickwork", 95000, 60000],
    ["1030", "Roofing", 78000, 0],
    ["1035", "Windows & Glazing", 165000, 40000],
    ["1040", "Electrical", 120000, 30000],
    ["1045", "Plumbing", 110000, 25000],
    ["1050", "Plastering", 90000, 0],
    ["1055", "Joinery", 210000, 0],
    ["1060", "Tiling", 85000, 0],
    ["1065", "Painting", 70000, 0],
    ["1070", "Landscaping", 95000, 0],
  ];
  const codeId: Record<string, string> = {};
  for (const [code, name, est, cur] of codes) {
    const cc = await db.costCode.create({ data: { projectId: pid, code, name } });
    codeId[code] = cc.id;
    await db.estimateLineItem.create({
      data: { projectId: pid, costCodeId: cc.id, description: name, quantity: 1, unit: "item", unitCostCents: c(est), totalCents: c(est) },
    });
    if (cur > 0) {
      await db.costActual.create({
        data: { projectId: pid, costCodeId: cc.id, xeroAccountCode: code, xeroSourceId: `seed:${code}`, description: "Current cost", amountCents: c(cur), occurredAt: new Date() },
      });
    }
  }

  // ── Variations: one approved, one submitted (awaiting client) + sub quote ──
  const vApproved = await db.variation.create({
    data: { projectId: pid, variationNumber: 1, title: "Upgrade to Calacatta benchtops (V-001)", status: VariationStatus.APPROVED, totalCents: c(28000), approvedAt: new Date() },
  });
  await db.variationLineItem.create({ data: { variationId: vApproved.id, description: "Calacatta marble supply & install", quantity: 1, unit: "item", unitCostCents: c(28000), totalCents: c(28000) } });

  const vSubmitted = await db.variation.create({
    data: { projectId: pid, variationNumber: 2, title: "Add rooftop pergola & screening (V-002)", status: VariationStatus.SUBMITTED, totalCents: c(42000) },
  });
  await db.variationLineItem.createMany({ data: [
    { variationId: vSubmitted.id, description: "Spotted gum pergola structure", quantity: 1, unit: "item", unitCostCents: c(31000), totalCents: c(31000) },
    { variationId: vSubmitted.id, description: "Aluminium privacy screening", quantity: 1, unit: "item", unitCostCents: c(11000), totalCents: c(11000) },
  ] });
  const quoteKey = await putFile(pid, "quotes", "pergola-quote.pdf", PDF, "application/pdf");
  await db.subcontractorQuote.create({ data: { variationId: vSubmitted.id, vendorName: "Northern Beaches Carpentry", amountCents: c(31000), fileKey: quoteKey, originalName: "pergola-quote.pdf" } });

  // ── Schedule (Gantt) ──
  const sched: [string, string, string, string, number][] = [
    // group, task, start, end, %complete
    ["Site & Structure", "Site establishment", "2025-09-01", "2025-09-12", 100],
    ["Site & Structure", "Excavation & footings", "2025-09-15", "2025-10-10", 100],
    ["Site & Structure", "Slab & concreting", "2025-10-13", "2025-11-14", 100],
    ["Frame & Roof", "Framing", "2025-11-17", "2025-12-19", 85],
    ["Frame & Roof", "Roof installation", "2026-01-05", "2026-01-30", 0],
    ["Lock-up", "Windows & external doors", "2026-02-02", "2026-02-27", 30],
    ["Lock-up", "Brickwork", "2026-02-09", "2026-03-13", 60],
    ["Services", "Electrical rough-in", "2026-03-02", "2026-03-20", 40],
    ["Services", "Plumbing rough-in", "2026-03-09", "2026-03-27", 25],
    ["Fit-out", "Plastering", "2026-04-06", "2026-04-30", 0],
    ["Fit-out", "Joinery", "2026-05-04", "2026-06-12", 0],
    ["Fit-out", "Tiling", "2026-05-18", "2026-06-12", 0],
    ["Fit-out", "Painting", "2026-06-15", "2026-07-10", 0],
    ["External", "Landscaping", "2026-07-13", "2026-08-14", 0],
    ["External", "Final clean & handover", "2026-08-17", "2026-08-28", 0],
  ];
  await db.scheduleItem.createMany({ data: sched.map(([group, taskName, s, e, pct], i) => {
    const start = new Date(s + "T00:00:00Z"); const end = new Date(e + "T00:00:00Z");
    return { projectId: pid, group, taskName, startDate: start, endDate: end, durationDays: Math.round((end.getTime() - start.getTime()) / 86_400_000), percentComplete: pct, sortOrder: i };
  }) });

  // ── Progress claim (recon-built, submitted for client approval) ──
  const labour = c(45000), costs = c(132000);
  const margin = Math.round((labour + costs) * 0.125);
  const subtotal = labour + costs + margin;
  const gst = Math.round(subtotal * 0.1);
  const claim = await db.progressClaim.create({
    data: {
      projectId: pid, claimNumber: 1, status: ClaimStatus.SUBMITTED, submittedById: builder.id, submittedAt: new Date(),
      periodLabel: "May-26", reconInvoiceRef: "Xero Inv 12", periodEnd: new Date("2026-05-31T00:00:00Z"),
      labourCents: labour, costsCents: costs, marginPercent: 12.5, marginCents: margin, subtotalCents: subtotal, gstCents: gst, totalCents: subtotal + gst,
      narrative: "Frame complete to roof height and signed off. Brickwork underway to the eastern and northern elevations (~60%). Electrical and plumbing rough-ins progressing on the ground floor. Windows scheduled to begin early next period.",
      reconSheetKey: await putFile(pid, "claims", "may-reconciliation.xlsx", PDF, "application/octet-stream"),
      reconSheetName: "may-reconciliation.xlsx",
      xeroInvoiceKey: await putFile(pid, "invoices", "tax-invoice-12.pdf", PDF, "application/pdf"),
      xeroInvoiceName: "tax-invoice-12.pdf",
    },
  });
  const claimLines: [string, number, number][] = [
    // code, current this period, prior
    ["1020", 40000, 110000], ["1025", 35000, 25000], ["1040", 18000, 12000], ["1045", 14000, 11000], ["1035", 25000, 15000],
  ];
  await db.claimLineItem.createMany({ data: claimLines.map(([code, cur, prior]) => ({
    claimId: claim.id, costCodeId: codeId[code] ?? null, description: codes.find((x) => x[0] === code)![1],
    claimedAmountCents: c(cur), priorCents: c(prior), toDateCents: c(cur + prior),
  })) });
  await db.claimReconLine.createMany({ data: [
    { claimId: claim.id, supplier: "Brickforce P/L", documentNumber: "Inv 2231", allocation: "Brickwork", amountCents: c(35000) },
    { claimId: claim.id, supplier: "Spark Electrical", documentNumber: "Inv 884", allocation: "Electrical", amountCents: c(18000) },
    { claimId: claim.id, supplier: "FlowPlumb", documentNumber: "Inv 1190", allocation: "Plumbing", amountCents: c(14000) },
    { claimId: claim.id, supplier: "ClearView Glazing", documentNumber: "Inv 540", allocation: "Windows & Glazing", amountCents: c(25000) },
    { claimId: claim.id, supplier: "Carpentry Co", documentNumber: "Inv 77", allocation: "Framing", amountCents: c(40000) },
  ] });

  // ── Calendar (site meetings) ──
  await db.calendarEvent.createMany({ data: [
    { projectId: pid, title: "Fortnightly site walk", location: "On site", startsAt: new Date("2026-05-20T01:00:00Z"), endsAt: new Date("2026-05-20T02:00:00Z"), createdById: builder.id },
    { projectId: pid, title: "Joinery selections review", location: "J Group office", startsAt: new Date("2026-05-27T03:00:00Z"), endsAt: new Date("2026-05-27T04:00:00Z"), createdById: builder.id },
  ] });

  // ── Photos (two albums) ──
  for (const album of ["Site Establishment", "Framing"]) {
    const folder = await db.photoFolder.create({ data: { projectId: pid, name: album } });
    for (let i = 1; i <= 3; i++) {
      const key = await putFile(pid, "photos", `${album}-${i}.png`, PNG, "image/png");
      await db.photo.create({ data: { projectId: pid, folderId: folder.id, fileKey: key, originalName: `${album}-${i}.png`, caption: `${album} ${i}`, uploadedById: builder.id } });
    }
  }

  // ── Design documents (each kind) ──
  const docs: [DesignDocKind, string, string][] = [
    [DesignDocKind.ARCHITECTURAL, "Ground Floor Plan", "ground-floor-plan.pdf"],
    [DesignDocKind.INTERIOR, "Kitchen Joinery Detail", "kitchen-joinery.pdf"],
    [DesignDocKind.OTHER, "Geotechnical Soil Report", "soil-report.pdf"],
  ];
  for (const [kind, title, file] of docs) {
    const key = await putFile(pid, "docs", file, PDF, "application/pdf");
    await db.designDocument.create({ data: { projectId: pid, kind, title, fileKey: key, originalName: file, uploadedById: builder.id } });
  }

  // ── Handover documents (Register / O&M / J Group) ──
  const handoverDocs: [HandoverDocKind, string, string][] = [
    [HandoverDocKind.REGISTER, "Handover Document Register", "register-index.pdf"],
    [HandoverDocKind.OM_MANUAL, "HVAC Operation Manual", "hvac-om.pdf"],
    [HandoverDocKind.OM_MANUAL, "Pool Pump O&M", "pool-pump-om.pdf"],
    [HandoverDocKind.JGROUP, "J Group Handover Certificate", "jg-handover-cert.pdf"],
    [HandoverDocKind.JGROUP, "Practical Completion Notice", "practical-completion.pdf"],
  ];
  for (const [kind, title, file] of handoverDocs) {
    const key = await putFile(pid, "handover", file, PDF, "application/pdf");
    await db.handoverDocument.create({ data: { projectId: pid, kind, title, fileKey: key, originalName: file, uploadedById: builder.id } });
  }

  // ── Warranties (structured) ──
  const warranties: [string, string, string][] = [
    ["Roof membrane", "Apex Roofing Systems", "2036-08-01"],
    ["Waterproofing (wet areas)", "SealTech", "2033-06-15"],
    ["Appliances package", "Miele Australia", "2028-05-01"],
    ["Pool shell", "AquaBuild", "2046-04-01"],
  ];
  for (const [item, issuer, exp] of warranties) {
    const key = await putFile(pid, "handover", `${item}-warranty.pdf`, PDF, "application/pdf");
    await db.warranty.create({ data: { projectId: pid, item, issuer, expiryDate: new Date(exp), fileKey: key, originalName: `${item}-warranty.pdf` } });
  }

  // ── Maintenance schedule (items with due dates feed the shared calendar) ──
  const maint: [string, string, string][] = [
    ["Service HVAC system", "Every 6 months", "2026-11-01"],
    ["Pool filter & chemical check", "Quarterly", "2026-09-01"],
    ["Gutter clean", "Annually", "2027-03-01"],
  ];
  for (const [title, frequency, due] of maint) {
    const at = new Date(`${due}T23:00:00Z`);
    const ev = await db.calendarEvent.create({ data: { projectId: pid, kind: CalendarEventKind.MAINTENANCE, title: `Maintenance: ${title}`, startsAt: at, endsAt: new Date(at.getTime() + 3_600_000), createdById: builder.id } });
    await db.maintenanceScheduleItem.create({ data: { projectId: pid, title, frequency, nextDueDate: at, calendarEventId: ev.id } });
  }

  // ── A client service booking + quote request ──
  await db.serviceBooking.create({ data: { projectId: pid, requestedById: client.id, title: "Squeaky door hinge — master bedroom", description: "Door creaks when opening.", status: ServiceBookingStatus.REQUESTED } });
  await db.quoteRequest.create({ data: { projectId: pid, requestedById: client.id, title: "Re-stain rear deck", description: "Deck looking weathered after summer.", status: QuoteRequestStatus.OPEN } });

  // Land the demo in the HANDOVER phase to showcase the lifecycle.
  await db.project.update({ where: { id: pid }, data: { phase: ProjectPhase.HANDOVER } });

  console.log(`Demo project ready: ${PROJECT} (${pid})`);
  console.log(`  Client: whitfield@example.test / client123`);
  console.log(`  PM:     priya@jgroup.test / manager123`);
  await db.$disconnect();
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
