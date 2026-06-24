"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importEstimate, type ImportResult } from "./actions";

export function UploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await importEstimate(projectId, form);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <p className="mb-3 text-sm text-stone-600">
        Upload an estimate spreadsheet (.xlsx or .csv). Expected columns: <code>Cost Code</code>,{" "}
        <code>Cost Code Description</code>, <code>Line Item Description</code>, <code>Qty</code>,{" "}
        <code>Unit</code>, <code>Cost per Quantity</code>, <code>Overall Cost</code>. Use the{" "}
        <strong>Blank template</strong> for the exact layout.
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
          {pending ? "Importing…" : "Import estimate"}
        </button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" name="replace" defaultChecked className="h-4 w-4" />
        Replace the current estimate (clears the existing lines, then imports)
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
