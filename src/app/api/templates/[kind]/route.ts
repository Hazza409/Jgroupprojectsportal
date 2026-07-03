import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSessionUser } from "@/auth";

// Blank Excel templates matching each importer's expected columns. A header row
// plus one greyed example row so the format is unambiguous. Auth required.
const TEMPLATES: Record<string, { file: string; headers: string[]; example: (string | number)[] }> = {
  estimate: {
    file: "estimate-template.xlsx",
    headers: ["Cost Code", "Cost Code Description", "Line Item Description", "Qty", "Unit", "Cost per Quantity", "Overall Cost"],
    example: ["1015", "Concreting", "Slab & footings to engineer's detail", 1, "item", 877239.56, 877239.56],
  },
  schedule: {
    file: "schedule-template.xlsx",
    headers: ["Phase", "Task", "Start", "Finish", "Duration (Days)", "% Complete"],
    example: ["Framing", "Install Framing", "2025-10-01", "2025-11-12", 42, 100],
  },
  "current-costs": {
    file: "cost-to-complete-template.xlsx",
    headers: ["Cost Code", "Cost Item", "Estimate", "Current Cost to Date"],
    example: ["1015", "Concreting", 877239.56, 887396.49],
  },
  variations: {
    file: "variations-template.xlsx",
    // Rows sharing a VO #/Title group into one variation. Unit Cost is the BASE
    // cost — the app adds builder's margin + GST for the client automatically.
    headers: ["VO #", "Title", "Description", "Line Description", "Qty", "Unit", "Unit Cost", "Status"],
    example: [1, "Upgrade to stone benchtops", "Kitchen island upgrade", "Natural stone supply & install", 1, "item", 4500, "DRAFT"],
  },
  subcontractors: {
    file: "subcontractors-template.xlsx",
    headers: ["Trade", "Company", "Contact", "Phone", "Email"],
    example: ["Electrical", "Bright Sparks Pty Ltd", "Dave Sparks", "0400 111 222", "dave@brightsparks.com.au"],
  },
};

export async function GET(_req: Request, { params }: { params: { kind: string } }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const tpl = TEMPLATES[params.kind];
  if (!tpl) return new NextResponse("Unknown template", { status: 404 });

  const ws = XLSX.utils.aoa_to_sheet([tpl.headers, tpl.example]);
  ws["!cols"] = tpl.headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template");
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${tpl.file}"`,
    },
  });
}
