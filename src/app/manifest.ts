import type { MetadataRoute } from "next";

// Web-app manifest — makes the dashboard installable ("Add to Home Screen"):
// it gets the J icon, opens full-screen without browser chrome, and is themed
// to the brand ebony. Served automatically at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "J Group Projects",
    short_name: "J Group",
    description: "Client & builder dashboard for J Group Projects.",
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
