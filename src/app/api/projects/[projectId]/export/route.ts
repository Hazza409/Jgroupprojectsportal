import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { canAccessProject } from "@/lib/scope";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { buildProjectWorkbook } from "@/lib/excel/exportProject";

// Download a full-project Excel workbook (Summary, Cost to Complete, Estimate,
// Variations, Progress Claims, Schedule). This route lives OUTSIDE the project
// layout, so it enforces scope + the client-view financial gate itself — the
// same rule as the printable claim: a client on the Handover view (which hides
// all construction/financial modules) must not pull financials by deep link.
export async function GET(_req: Request, { params }: { params: { projectId: string } }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { projectId } = params;
  if (!(await canAccessProject(user, projectId))) return new NextResponse("Not found", { status: 404 });

  const project = await db.project.findUnique({ where: { id: projectId }, select: { clientView: true } });
  if (!project) return new NextResponse("Not found", { status: 404 });
  if (user.role === "CLIENT" && project.clientView === "HANDOVER") {
    return new NextResponse("Not found", { status: 404 });
  }

  const company = await getCompany();
  const { buffer, filename } = await buildProjectWorkbook(projectId, company);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
