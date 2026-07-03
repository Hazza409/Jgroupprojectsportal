"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { slug: string; label: string };
type Section = { key: string; label: string; group?: "build" | "care"; items: Item[] };

const SECTIONS: Section[] = [
  { key: "top", label: "", items: [{ slug: "", label: "Overview" }, { slug: "contacts", label: "" /* set per-company below */ }] },
  {
    key: "build",
    label: "Build",
    group: "build",
    items: [
      { slug: "estimate", label: "Original Estimate" },
      { slug: "cost-to-complete", label: "Cost to Complete" },
      { slug: "progress-claims", label: "Progress Claims" },
      { slug: "variations", label: "Variations" },
      { slug: "rfis", label: "RFIs" },
      { slug: "schedule", label: "Schedule" },
      { slug: "calendar", label: "Calendar" },
      { slug: "updates", label: "Fortnightly Summary" },
      { slug: "photos", label: "Photos" },
      { slug: "documents", label: "Drawings & Design" },
    ],
  },
  {
    key: "care",
    label: "Handover & Maintenance",
    group: "care",
    items: [
      { slug: "handover", label: "Handover" },
      { slug: "maintenance", label: "Maintenance" },
    ],
  },
];

export function ProjectNav({
  projectId,
  clientView,
  isBuilder = false,
  contactsLabel,
}: {
  projectId: string;
  clientView: "CONSTRUCTION" | "HANDOVER";
  isBuilder?: boolean;
  /** Company-branded label for the contacts item, e.g. "J Group Contacts". */
  contactsLabel: string;
}) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const activeGroup: "build" | "care" = clientView === "HANDOVER" ? "care" : "build";

  // Builders see every section. Clients see Overview plus EITHER the build
  // modules OR the Handover & Maintenance area, depending on the builder's
  // client-view switch. (Enforced server-side in the project layout too.)
  const visible = SECTIONS.filter((s) => {
    if (!s.group) return true; // Overview always
    if (isBuilder) return true;
    return s.group === activeGroup;
  });

  const sections = isBuilder
    ? [...visible, { key: "admin", label: "Admin", items: [{ slug: "settings", label: "Settings" }] } as Section]
    : visible;

  return (
    <nav className="space-y-4">
      {sections.map((section) => (
        <div key={section.key} className="space-y-1">
          {section.label && (
            <p className="flex items-center gap-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">
              {section.label}
              {isBuilder && section.group === activeGroup && (
                <span className="h-1.5 w-1.5 rounded-full bg-brand" title="Currently shown to the client" />
              )}
            </p>
          )}
          {section.items.map((m) => {
            const href = m.slug ? `${base}/${m.slug}` : base;
            const active = m.slug ? pathname.startsWith(href) : pathname === base;
            return (
              <Link
                key={m.slug || "overview"}
                href={href}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active ? "bg-brand text-onbrand" : "text-stone-700 hover:bg-stone-100"
                }`}
              >
                {m.slug === "contacts" ? contactsLabel : m.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
