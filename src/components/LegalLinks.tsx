import Link from "next/link";
import { LEGAL_DOCS, LEGAL_ORDER } from "@/lib/legal";

/**
 * Footer links to the terms, privacy policy and cookie notice.
 *
 * Reachable from the landing page and the sign-in page, so someone can read
 * them before handing over an email address or accepting anything — a privacy
 * policy only visible after you have signed up is no use to the person
 * deciding whether to.
 */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500 ${className}`}>
      {LEGAL_ORDER.map((slug) => (
        <Link key={slug} href={`/legal/${slug}`} className="hover:text-ink hover:underline underline-offset-2">
          {LEGAL_DOCS[slug].title}
        </Link>
      ))}
    </nav>
  );
}
