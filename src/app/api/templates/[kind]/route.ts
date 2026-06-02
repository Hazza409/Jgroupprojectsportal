import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSessionUser } from "@/auth";

// Blank Excel templates matching each importer's expected columns. A header row
// plus one greyed example row so the format is unambiguous. Auth required.
const TEMPLATES: Record<string, { file: string; headers: string[]; example: (string | number)[] }> = {
  estimate: {
    file: "jgroup-estimate-template.xlsx",
    headers: ["Cost Code", "Description", "Qty", "Unit", "Unit Cost", "Total"],
    example: ["1015", "Concreting", 1, "item", 877239.56, 877239.56],
  },
  schedule: {
    file: "jgroup-schedule-template.xlsx",
    headers: ["Phase", "Task", "Start", "Finish", "Duration (Days)", "% Complete"],
    example: ["Framing", "Install Framing", "2025-10-01", "2025-11-12", 42, 100],
  },
  "current-costs": {
    file: "jgroup-current-costs-template.xlsx",
    headers: ["Cost Code", "Cost Item", "Amount"],
    example: ["1015", "Concreting", 887396.49],
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
