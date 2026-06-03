"use client";

import { useRef, useState, useTransition } from "react";
import { setClientPassword, type SimpleResult } from "@/app/projects/[projectId]/actions";

type Client = { id: string; email: string; name: string };

function ClientRow({ projectId, client }: { projectId: string; client: Client }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SimpleResult | null>(null);
  const [value, setValue] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await setClientPassword(projectId, client.id, form);
      setResult(res);
      if (res.ok) setValue(""); // clear on success
    });
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{client.name}</p>
          <p className="text-xs text-stone-400">{client.email}</p>
        </div>
        <form ref={formRef} onSubmit={onSubmit} className="flex items-end gap-2">
          <div>
            <label className="label">New password</label>
            <input
              name="password"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              minLength={8}
              className="input !w-56"
              placeholder="At least 8 characters"
            />
          </div>
          <button className="btn-primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Set password"}
          </button>
        </form>
      </div>
      <p className="mt-1 text-xs text-stone-400">
        Minimum 8 characters. The client signs in with <span className="font-medium text-stone-300">{client.email}</span> + this password (no spaces).
      </p>
      {result && (
        <p className={`mt-2 rounded-md px-3 py-2 text-sm ${result.ok ? "bg-emerald-500/10 dark:bg-emerald-400/10 text-emerald-700 dark:text-emerald-200 ring-1 ring-emerald-500/30 dark:ring-emerald-400/30" : "bg-red-500/10 dark:bg-red-400/10 text-red-700 dark:text-red-200 ring-1 ring-red-500/30 dark:ring-red-400/30"}`}>
          {result.ok ? "✓ " : "⚠ "}{result.message}
        </p>
      )}
    </li>
  );
}

export function ClientAccessCard({ projectId, clients }: { projectId: string; clients: Client[] }) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Client access</h2>
      {clients.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">No client login on this project yet. Add one via New job, or invite later.</p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100">
          {clients.map((c) => <ClientRow key={c.id} projectId={projectId} client={c} />)}
        </ul>
      )}
    </div>
  );
}
