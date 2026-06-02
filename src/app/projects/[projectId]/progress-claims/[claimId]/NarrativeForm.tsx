"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateNarrative } from "../actions";

export function NarrativeForm({
  projectId,
  claimId,
  initial,
}: {
  projectId: string;
  claimId: string;
  initial: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      await updateNarrative(projectId, claimId, form);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <textarea
        name="narrative"
        defaultValue={initial}
        rows={5}
        className="input resize-y"
        placeholder="Summarise progress over the last two weeks — works completed, milestones reached, anything the client should know…"
        onChange={() => setSaved(false)}
      />
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save update"}
        </button>
        {saved && <span className="text-sm text-emerald-200">Saved.</span>}
      </div>
    </form>
  );
}
