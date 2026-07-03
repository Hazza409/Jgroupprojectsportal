import Link from "next/link";
import { notFound } from "next/navigation";
import { HandoverDocKind } from "@prisma/client";
import { assertProjectAccess } from "@/lib/scope";
import { ModuleHeader } from "@/components/ModuleHeader";
import { DocStore } from "@/components/DocStore";
import { getCompany, companyShortName } from "@/lib/company";

// Maps a URL slug → HandoverDocKind + display copy. (Warranties has its own page.)
const STORES: Record<string, { kind: HandoverDocKind; title: string; desc: string }> = {
  register: { kind: "REGISTER", title: "Document Register", desc: "Master index of all handover documents." },
  "om-manuals": { kind: "OM_MANUAL", title: "O&M Manuals", desc: "Operation & maintenance manuals." },
  // Title resolved per-request from Company settings (see below).
  jgroup: { kind: "JGROUP", title: "", desc: "Company-issued handover documents." },
};

export default async function HandoverStorePage({ params }: { params: { projectId: string; store: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const cfg = STORES[params.store];
  if (!cfg) notFound();
  const company = await getCompany();
  const title = cfg.kind === "JGROUP" ? `${companyShortName(company)} Documents` : cfg.title;

  return (
    <div>
      <Link href={`/projects/${params.projectId}/handover`} className="text-sm text-stone-500 hover:text-ink">
        ← Handover
      </Link>
      <div className="mt-2">
        <ModuleHeader title={title} description={cfg.desc} />
      </div>
      <DocStore projectId={params.projectId} kind={cfg.kind} isBuilder={user.role === "BUILDER"} />
    </div>
  );
}
