import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { getCompany, companyShortName, brandColorCss } from "@/lib/company";

// Branding comes from Company settings (DB), so nothing may be baked into
// static HTML at build time — the whole app renders per-request.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const company = await getCompany();
  return {
    title: `${company.name} — Dashboard`,
    description: `Client & builder dashboard for ${company.name}.`,
    // Installable home-screen app (see src/app/manifest.ts + public/icons).
    manifest: "/manifest.webmanifest",
    icons: { apple: "/icons/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: companyShortName(company), statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = {
  themeColor: "#161514",
};

// Applies the saved theme before first paint (default: dark/night) so there's no
// flash. Tailwind's class-based dark mode needs the `dark` class present.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const company = await getCompany();
  const brandCss = brandColorCss(company);
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {brandCss && <style dangerouslySetInnerHTML={{ __html: brandCss }} />}
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
