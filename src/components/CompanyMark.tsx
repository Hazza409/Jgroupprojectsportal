import { BrandMark } from "./BrandMark";
import { storage } from "@/lib/storage";
import type { Company } from "@prisma/client";

// The company logo: the uploaded image when one is set in Company settings,
// else the built-in "J" mark (J Group's default). Server component — resolves
// the storage URL here so callers stay simple.
export async function CompanyMark({
  company,
  className = "",
  imgClassName,
}: {
  company: Company;
  className?: string;
  /** Sizing for the uploaded-logo <img>; defaults to className. */
  imgClassName?: string;
}) {
  if (company.logoKey) {
    const store = await storage();
    const src = await store.url(company.logoKey);
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={`${company.name} logo`} className={`${imgClassName ?? className} object-contain`} />;
  }
  return <BrandMark className={className} />;
}
