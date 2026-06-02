"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MODULES = [
  { slug: "", label: "Overview" },
  { slug: "estimate", label: "Original Estimate" },
  { slug: "cost-to-complete", label: "Cost to Complete" },
  { slug: "progress-claims", label: "Progress Claims" },
  { slug: "variations", label: "Variations" },
  { slug: "schedule", label: "Schedule" },
  { slug: "calendar", label: "Calendar" },
  { slug: "photos", label: "Photos" },
  { slug: "documents", label: "Drawings & Design" },
];

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav className="space-y-1">
      {MODULES.map((m) => {
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
    </nav>
  );
}
