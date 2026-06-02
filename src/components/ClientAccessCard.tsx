"use client";

import { useState, useTransition } from "react";
import { setClientPassword, type SimpleResult } from "@/app/projects/[projectId]/actions";

type Client = { id: string; email: string; name: string };

function ClientRow({ projectId, client }: { projectId: string; client: Client }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SimpleResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => setResult(await setClientPassword(projectId, client.id, form)));
  }

  return (
    <li className="flex flex-wrap items-end justify-between gap-3 py-3">
      <div>
        <p className="text-sm font-medium">{client.name}</p>
        <p className="text-xs text-stone-400">{client.email}</p>
      </div>
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <input name="password" type="text" className="input !w-48" placeholder="New password (min 8)" />
        <button className="btn-ghost" type="submit" disabled={pending}>{pending ? "Saving…" : "Set password"}</button>
        {result && <span className={`text-xs ${result.ok ? "text-emerald-200" : "text-red-300"}`}>{result.message}</span>}
      </form>
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
