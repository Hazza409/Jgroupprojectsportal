import type { MetadataRoute } from "next";
import { getCompany, companyShortName } from "@/lib/company";

// Company name comes from settings — serve fresh, never bake at build time.
export const dynamic = "force-dynamic";

// Web-app manifest — makes the dashboard installable ("Add to Home Screen"):
// it gets the brand icon, opens full-screen without browser chrome, and is
// themed to the brand ebony. Served automatically at /manifest.webmanifest.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // Build-time safety: Next statically exports manifest routes at build even
  // with force-dynamic (Render's build runs BEFORE `prisma migrate deploy`,
  // so the Company table may not exist yet). Never let that fail the build —
  // fall back to the seeded J Group values. (This exact failure took prod
  // down on 2026-07-07: "Export encountered errors: /manifest.webmanifest".)
  let name = "J Group Projects";
  let shortName = "J Group";
  try {
    const company = await getCompany();
    name = company.name;
    shortName = companyShortName(company);
  } catch {
    // DB unreachable / not yet migrated (build environment) — use fallbacks.
  }
  return {
    name,
    short_name: shortName,
    description: `Client & builder dashboard for ${name}.`,
    start_url: "/",
    display: "standalone",
    // Launch splash matches the icon/logo: charcoal mark on white.
    background_color: "#ffffff",
    theme_color: "#161514",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
