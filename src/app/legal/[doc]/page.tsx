import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCompany } from "@/lib/company";
import { LEGAL_DOCS, LEGAL_ORDER, type LegalDocSlug } from "@/lib/legal";

/**
 * Terms of use, privacy policy and cookie notice.
 *
 * Deliberately OUTSIDE the login wall: someone deciding whether to accept
 * terms has to be able to read them first, and a privacy policy that only
 * existing users can reach is not a privacy policy.
 *
 * While a document is a draft the page says so at the top and shows the
 * drafting notes, so nobody mistakes a skeleton for a settled position — and
 * so whoever drafts it can see what each clause has to do.
 */

export function generateStaticParams() {
  return LEGAL_ORDER.map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: { doc: string } }): Promise<Metadata> {
  const d = LEGAL_DOCS[params.doc as LegalDocSlug];
  if (!d) return {};
  const company = await getCompany();
  return { title: `${d.title} — ${company.name}` };
}

export default async function LegalPage({ params }: { params: { doc: string } }) {
  const doc = LEGAL_DOCS[params.doc as LegalDocSlug];
  if (!doc) notFound();
  const company = await getCompany();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-stone-500 hover:text-ink">
        ← {company.name}
      </Link>

      <h1 className="mt-6 text-2xl font-semibold">{doc.title}</h1>
      <p className="mt-1 text-sm text-stone-500">{doc.summary}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-stone-400">
        Version {doc.version}
        {doc.inForce ? "" : " · not in force"}
      </p>

      {!doc.inForce && (
        <div className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          <p className="font-medium">Draft — this document is not in force.</p>
          <p className="mt-1">
            {doc.slug === "cookies"
              ? "The description of what is stored is accurate, but the document has not been reviewed and is not yet published. The notes below flag what still needs confirming."
              : "The structure below sets out what each clause needs to cover. The wording has deliberately not been written — a document of this kind needs a solicitor, and clauses that merely sound right would be worse than having none."}{" "}
            Nobody is being asked to accept it.
          </p>
        </div>
      )}

      <div className="mt-8 space-y-8">
        {doc.sections.map((s, i) => (
          <section key={s.heading}>
            <h2 className="text-sm font-semibold">
              <span className="mr-2 tabular-nums text-stone-400">{i + 1}.</span>
              {s.heading}
            </h2>
            {s.body && <p className="mt-2 text-sm leading-relaxed text-stone-600">{s.body}</p>}
            {!doc.inForce && s.mustCover && s.mustCover.length > 0 && (
              <div className="mt-2 rounded-md border border-stone-200 bg-stone-100/50 p-3 dark:border-stone-700 dark:bg-stone-800/40">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                  {s.body ? "Still to confirm" : "This clause must cover"}
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-stone-500">
                  {s.mustCover.map((m, j) => (
                    <li key={j}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="mt-12 flex flex-wrap gap-4 border-t border-stone-200 pt-6 text-sm dark:border-stone-700">
        {LEGAL_ORDER.filter((s) => s !== doc.slug).map((s) => (
          <Link key={s} href={`/legal/${s}`} className="text-stone-500 hover:text-ink">
            {LEGAL_DOCS[s].title} →
          </Link>
        ))}
      </div>
    </main>
  );
}
