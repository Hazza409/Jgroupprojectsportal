import type { MetadataRoute } from "next";
import { getCompany, companyShortName } from "@/lib/company";

// Company name comes from settings — serve fresh, never bake at build time.
export const dynamic = "force-dynamic";

// Web-app manifest — makes the dashboard installable ("Add to Home Screen"):
// it gets the brand icon, opens full-screen without browser chrome, and is
// themed to the brand ebony. Served automatically at /manifest.webmanifest.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const company = await getCompany();
  return {
    name: company.name,
    short_name: companyShortName(company),
    description: `Client & builder dashboard for ${company.name}.`,
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
