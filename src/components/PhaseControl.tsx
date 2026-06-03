"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPhase } from "@/app/projects/[projectId]/actions";

const PHASES: { key: "BUILD" | "HANDOVER" | "MAINTENANCE"; label: string }[] = [
  { key: "BUILD", label: "Build" },
  { key: "HANDOVER", label: "Handover" },
  { key: "MAINTENANCE", label: "Maintenance" },
];

export function PhaseControl({ projectId, phase }: { projectId: string; phase: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go(p: "BUILD" | "HANDOVER" | "MAINTENANCE") {
    if (p === phase) return;
    startTransition(async () => {
      await setPhase(projectId, p);
      router.refresh();
    });
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-400">Project phase</p>
          <p className="mt-1 text-sm text-stone-500">Advance the lifecycle to surface the next module suite. All data stays accessible.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-stone-200 p-1">
          {PHASES.map((p) => (
            <button
              key={p.key}
              onClick={() => go(p.key)}
              disabled={pending}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                p.key === phase ? "bg-brand text-onbrand" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
