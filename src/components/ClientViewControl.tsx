"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setClientView } from "@/app/projects/[projectId]/actions";

const VIEWS: { key: "CONSTRUCTION" | "HANDOVER"; label: string }[] = [
  { key: "CONSTRUCTION", label: "Construction" },
  { key: "HANDOVER", label: "Handover & Maintenance" },
];

// Builder-only switch that controls what the CLIENT sees. Builders always see
// every module; this only changes the client's view.
export function ClientViewControl({ projectId, clientView }: { projectId: string; clientView: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go(v: "CONSTRUCTION" | "HANDOVER") {
    if (v === clientView) return;
    startTransition(async () => {
      await setClientView(projectId, v);
      router.refresh();
    });
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-400">What your client sees</p>
          <p className="mt-1 text-sm text-stone-500">
            Switch the client between the construction view and the combined Handover &amp; Maintenance view.
            You always see everything.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-stone-200 p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => go(v.key)}
              disabled={pending}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                v.key === clientView ? "bg-brand text-onbrand" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
