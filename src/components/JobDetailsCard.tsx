"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobDetails } from "@/app/projects/[projectId]/actions";
import { runAction } from "@/lib/actionResult";

// Correcting a job's headline details after creation. Chiefly the contract
// value: it was write-once, so a typo could only be fixed by deleting the job
// and everything attached to it.
export function JobDetailsCard({
  projectId,
  name,
  address,
  contractDollars,
}: {
  projectId: string;
  name: string;
  address: string | null;
  /** Plain "3795456.70" — the number input can't take $ or commas. */
  contractDollars: string;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, start] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await runAction(() => updateJobDetails(projectId, fd));
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Job details</h2>
      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <div>
          <label htmlFor="jobName" className="mb-1 block text-sm">Job name</label>
          <input id="jobName" name="name" defaultValue={name} required className="input" />
        </div>
        <div>
          <label htmlFor="jobAddress" className="mb-1 block text-sm">Address</label>
          <input id="jobAddress" name="address" defaultValue={address ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="jobContract" className="mb-1 block text-sm">Contract value</label>
          <input
            id="jobContract"
            name="contractValue"
            type="number"
            step="0.01"
            min="0"
            defaultValue={contractDollars}
            className="input"
            placeholder="0.00"
          />
          <p className="mt-1 text-xs text-stone-400">
            The headline figure on the job card. Nothing is calculated from it — Cost to Complete works from
            the estimate and approved variations.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save details"}
          </button>
          {msg && (
            <span
              className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}
              role={msg.ok ? undefined : "alert"}
            >
              {msg.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
