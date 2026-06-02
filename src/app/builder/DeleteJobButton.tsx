"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteJob } from "./actions";

export function DeleteJobButton({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm(`Delete "${name}" and ALL its data (estimate, claims, photos, documents…)? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteJob(projectId);
      router.refresh();
    });
  }

  return (
    <button
      onClick={onClick}
      disabled={pending}
      className="text-xs text-stone-400 hover:text-red-300 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
