"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importSubcontractors, type ImportResult } from "./actions";

export function SubcontractorsUploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await importSubcontractors(projectId, form);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <p className="mb-3 text-sm text-stone-600">
        Upload a subcontractor list (.xlsx or .csv). Columns: <code>Trade</code>, <code>Company</code>,{" "}
        <code>Contact</code>, <code>Phone</code>, <code>Email</code>. Use the <strong>Blank template</strong> for the layout.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls,.csv"
          required
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm"
        />
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Importing…" : "Import subcontractors"}
        </button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" name="replace" defaultChecked className="h-4 w-4" />
        Replace the current list (clears the existing entries, then imports)
      </label>
      {result && (
        <div className={`mt-3 text-sm ${result.ok ? "text-brand" : "text-red-600 dark:text-red-300"}`}>
          {result.message}
          {result.warnings && result.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-stone-500">
              {result.warnings.slice(0, 5).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
