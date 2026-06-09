"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setClientPassword,
  addClientToProject,
  removeClientFromProject,
  type SimpleResult,
} from "@/app/projects/[projectId]/actions";

type Client = { id: string; email: string; name: string };

const OK = "bg-emerald-500/10 dark:bg-emerald-400/10 text-emerald-700 dark:text-emerald-200 ring-1 ring-emerald-500/30 dark:ring-emerald-400/30";
const BAD = "bg-red-500/10 dark:bg-red-400/10 text-red-700 dark:text-red-200 ring-1 ring-red-500/30 dark:ring-red-400/30";

function ClientRow({ projectId, client }: { projectId: string; client: Client }) {
  const router = useRouter();
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
      if (res.ok) setValue("");
    });
  }

  function onRemove() {
    if (!window.confirm(`Remove ${client.email}'s access to this project?`)) return;
    startTransition(async () => {
      await removeClientFromProject(projectId, client.id);
      router.refresh();
    });
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{client.name}</p>
          <p className="text-xs text-stone-400">{client.email}</p>
        </div>
        <div className="flex items-end gap-2">
          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <div>
              <label className="label">New password</label>
              <input
                name="password"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                minLength={8}
                className="input !w-48"
                placeholder="At least 8 characters"
              />
            </div>
            <button className="btn-primary" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Set password"}
            </button>
          </form>
          <button type="button" onClick={onRemove} disabled={pending} className="text-xs text-red-700 dark:text-red-300 hover:text-red-200">
            Remove
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-stone-400">
        Signs in with <span className="font-medium text-stone-300">{client.email}</span> + this password (min 8, no spaces).
      </p>
      {result && <p className={`mt-2 rounded-md px-3 py-2 text-sm ${result.ok ? OK : BAD}`}>{result.ok ? "✓ " : "⚠ "}{result.message}</p>}
    </li>
  );
}

function AddClientForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SimpleResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await addClientToProject(projectId, form);
      setResult(res);
      if (res.ok) {
        formRef.current?.reset();
        router.refresh(); // re-fetch the member list
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="mt-4 border-t border-stone-200 pt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Add a login</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Name / role</label>
          <input name="name" required className="input" placeholder="e.g. Jane (Architect)" />
        </div>
        <div>
          <label className="label">Email</label>
          <input name="email" type="email" required className="input" placeholder="architect@studio.com" />
        </div>
        <div>
          <label className="label">Temporary password</label>
          <input name="password" type="text" required minLength={8} className="input" placeholder="min 8 characters" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn-primary" type="submit" disabled={pending}>{pending ? "Adding…" : "Add login"}</button>
        {result && <span className={`rounded-md px-3 py-1.5 text-sm ${result.ok ? OK : BAD}`}>{result.ok ? "✓ " : "⚠ "}{result.message}</span>}
      </div>
    </form>
  );
}

export function ClientAccessCard({ projectId, clients }: { projectId: string; clients: Client[] }) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Client access</h2>
      <p className="mt-1 text-xs text-stone-400">
        Add as many logins as you need — owners, the architect, etc. Each gets the same view-only client access.
      </p>
      {clients.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">No logins on this project yet — add one below.</p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100">
          {clients.map((c) => <ClientRow key={c.id} projectId={projectId} client={c} />)}
        </ul>
      )}
      <AddClientForm projectId={projectId} />
    </div>
  );
}
