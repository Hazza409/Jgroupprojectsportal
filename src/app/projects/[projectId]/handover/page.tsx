import Link from "next/link";
import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";

// Handover hub — links to the per-project document repositories.
export default async function HandoverHub({ params }: { params: { projectId: string } }) {
  await assertProjectAccess(params.projectId);
  const projectId = params.projectId;

  const [register, om, jgroup, warranties] = await Promise.all([
    db.handoverDocument.count({ where: { projectId, kind: "REGISTER" } }),
    db.handoverDocument.count({ where: { projectId, kind: "OM_MANUAL" } }),
    db.handoverDocument.count({ where: { projectId, kind: "JGROUP" } }),
    db.warranty.count({ where: { projectId } }),
  ]);

  const cards = [
    { href: "handover/register", label: "Document Register", desc: "Master index of all handover documents.", count: register },
    { href: "handover/om-manuals", label: "O&M Manuals", desc: "Operation & maintenance manuals.", count: om },
    { href: "handover/warranties", label: "Warranties", desc: "Warranty records — issuer, item, expiry.", count: warranties },
    { href: "handover/jgroup", label: "J Group Documents", desc: "Company-issued handover documents.", count: jgroup },
  ];

  return (
    <div>
      <ModuleHeader title="Handover" description="Document repositories for project handover." />
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.href} href={`/projects/${projectId}/${c.href}`} className="card hover:shadow-md">
            <div className="flex items-start justify-between">
              <h3 className="font-medium">{c.label}</h3>
              <span className="badge bg-stone-100 text-stone-600 ring-1 ring-stone-200">{c.count}</span>
            </div>
            <p className="mt-1 text-sm text-stone-500">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
