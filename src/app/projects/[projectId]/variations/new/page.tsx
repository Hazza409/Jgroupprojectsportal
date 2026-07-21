import Link from "next/link";
import { redirect } from "next/navigation";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { createVariation } from "../actions";
import { NewVariationForm } from "./NewVariationForm";

export default async function NewVariationPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  if (user.role !== "BUILDER") redirect(`/projects/${projectId}/variations`);

  const costCodes = await db.costCode.findMany({
    where: { projectId },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  return (
    <div>
      <Link href={`/projects/${projectId}/variations`} className="text-sm text-stone-500 hover:text-ink">
        ← Variation Register
      </Link>
      <div className="mt-2">
        <ModuleHeader
          title="Add a variation"
          description="Add one or more line items — builder's margin & GST are added for the client automatically. (For many at once, use Import from Excel on the register.)"
        />
      </div>

      <NewVariationForm action={createVariation.bind(null, projectId)} projectId={projectId} costCodes={costCodes} />
    </div>
  );
}
