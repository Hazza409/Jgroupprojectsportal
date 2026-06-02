"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createJob } from "../actions";

export function CreateJobForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createJob(form);
      if (res.ok && res.projectId) {
        router.push(`/projects/${res.projectId}`);
        router.refresh();
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Job details</h2>
        <div>
          <label className="label" htmlFor="name">Job name</label>
          <input id="name" name="name" className="input" required placeholder="e.g. Hawthorn Residence" />
        </div>
        <div>
          <label className="label" htmlFor="address">Site address</label>
          <input id="address" name="address" className="input" placeholder="12 Riverview Tce, Hawthorn VIC" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="clientName">Client name</label>
            <input id="clientName" name="clientName" className="input" placeholder="Alex Client" />
          </div>
          <div>
            <label className="label" htmlFor="contractValue">Contract value ($)</label>
            <input id="contractValue" name="contractValue" type="number" step="0.01" className="input" placeholder="2850000.00" />
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Client login (optional)</h2>
          <p className="mt-1 text-xs text-stone-400">
            Provision the client&apos;s scoped access now. They&apos;ll see only this job. Leave blank to add them later.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="clientEmail">Client email</label>
            <input id="clientEmail" name="clientEmail" type="email" className="input" placeholder="client@example.com" />
          </div>
          <div>
            <label className="label" htmlFor="clientPassword">Temporary password</label>
            <input id="clientPassword" name="clientPassword" type="text" className="input" placeholder="min 8 characters" />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create job"}
        </button>
        <Link href="/builder" className="btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}
