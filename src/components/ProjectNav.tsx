"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { slug: string; label: string };
type Section = { key: string; label: string; phase?: "BUILD" | "HANDOVER" | "MAINTENANCE"; items: Item[] };

const SECTIONS: Section[] = [
  { key: "top", label: "", items: [{ slug: "", label: "Overview" }] },
  {
    key: "build",
    label: "Build",
    phase: "BUILD",
    items: [
      { slug: "estimate", label: "Original Estimate" },
      { slug: "cost-to-complete", label: "Cost to Complete" },
      { slug: "progress-claims", label: "Progress Claims" },
      { slug: "variations", label: "Variations" },
      { slug: "schedule", label: "Schedule" },
      { slug: "calendar", label: "Calendar" },
      { slug: "photos", label: "Photos" },
      { slug: "documents", label: "Drawings & Design" },
    ],
  },
  { key: "handover", label: "Handover", phase: "HANDOVER", items: [{ slug: "handover", label: "Handover" }] },
  { key: "maintenance", label: "Maintenance", phase: "MAINTENANCE", items: [{ slug: "maintenance", label: "Maintenance" }] },
];

export function ProjectNav({
  projectId,
  phase,
  isBuilder = false,
}: {
  projectId: string;
  phase: "BUILD" | "HANDOVER" | "MAINTENANCE";
  isBuilder?: boolean;
}) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  // Builder-only admin section appended at the end.
  const sections = isBuilder
    ? [...SECTIONS, { key: "admin", label: "Admin", items: [{ slug: "settings", label: "Settings" }] }]
    : SECTIONS;

  return (
    <nav className="space-y-4">
      {sections.map((section) => (
        <div key={section.key} className="space-y-1">
          {section.label && (
            <p className="flex items-center gap-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">
              {section.label}
              {section.phase === phase && <span className="h-1.5 w-1.5 rounded-full bg-brand" title="Current phase" />}
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
                  active ? "bg-brand text-ebony" : "text-stone-700 hover:bg-stone-100"
                }`}
              >
                {m.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
