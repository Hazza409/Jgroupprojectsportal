import type { MetadataRoute } from "next";

// The whole portal is private (client + builder data behind login). Tell every
// crawler not to index anything — belt to the X-Robots-Tag header in
// next.config.mjs. (Jake feedback 6.2: no search-engine indexing.)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
