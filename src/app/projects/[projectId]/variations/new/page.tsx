import Link from "next/link";
import { redirect } from "next/navigation";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { createVariation } from "../actions";

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
          description="Create a single variation manually. Enter the cost — builder's margin & GST are added for the client automatically. (For many at once, use Import from Excel on the register.)"
        />
      </div>

      <form action={createVariation.bind(null, projectId)} className="card grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Title</label>
          <input name="title" className="input" required placeholder="e.g. Upgrade to stone benchtops" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Description (optional)</label>
          <input name="description" className="input" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Adds to cost code (optional — auto-matched from the title if left blank)</label>
          <select name="costCodeId" className="input" defaultValue="">
            <option value="">— Auto-match / Unallocated —</option>
            {costCodes.map((c) => (
              <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Line description</label>
          <input name="lineDescription" className="input" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label">Qty</label>
            <input name="quantity" type="number" step="any" defaultValue={1} className="input" />
          </div>
          <div>
            <label className="label">Unit</label>
            <input name="unit" className="input" placeholder="ea" />
          </div>
          <div>
            <label className="label">Unit cost $</label>
            <input name="unitCost" type="number" step="0.01" className="input" placeholder="0.00" />
          </div>
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button className="btn-primary" type="submit">Create variation</button>
          <Link href={`/projects/${projectId}/variations`} className="btn-ghost">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
