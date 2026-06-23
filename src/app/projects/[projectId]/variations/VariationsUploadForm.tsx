"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importVariations, type ImportResult } from "./actions";

export function VariationsUploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await importVariations(projectId, form);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <p className="mb-3 text-sm text-stone-600">
        Upload a variations spreadsheet (.xlsx or .csv). Expected columns: <code>VO #</code>,{" "}
        <code>Title</code>, <code>Description</code>, <code>Line Description</code>, <code>Qty</code>,{" "}
        <code>Unit</code>, <code>Unit Cost</code>, <code>Status</code>. Rows sharing a VO #/Title group
        into one variation. Enter <strong>cost</strong> figures — margin &amp; GST are added automatically.
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
          {pending ? "Importing…" : "Import variations"}
        </button>
      </div>
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
