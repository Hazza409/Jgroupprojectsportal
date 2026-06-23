"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importCurrentCosts, type SyncResult } from "./actions";

export function CurrentCostsImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await importCurrentCosts(projectId, form);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  if (!open) {
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        Import / update from Excel
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <p className="mb-3 text-sm text-stone-500">
        Update the Cost to Complete from Excel or CSV — columns: <code>Cost Code</code>, <code>Cost Item</code>,{" "}
        <code>Estimate</code>, <code>Current Cost to Date</code> (enter base ex-margin / ex-GST amounts;
        leave a column blank to leave it unchanged). Re-importing updates each code.{" "}
        <Link href="/api/templates/current-costs" className="underline">Blank template</Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls,.csv"
          required
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm"
        />
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Importing…" : "Import"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        {result && <span className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>{result.message}</span>}
      </div>
    </form>
  );
}
