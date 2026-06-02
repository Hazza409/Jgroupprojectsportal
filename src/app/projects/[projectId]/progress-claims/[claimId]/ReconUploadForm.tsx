"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importReconSheet, type ReconImportResult } from "../actions";

export function ReconUploadForm({
  projectId,
  claimId,
  hasSheet,
}: {
  projectId: string;
  claimId: string;
  hasSheet: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ReconImportResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await importReconSheet(projectId, claimId, form);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="mb-3 text-sm text-stone-500">
        Upload the reconciliation sheet (.xlsx) — it builds this claim: line items, supplier backup,
        labour, builder&apos;s margin and GST. Re-uploading replaces everything from the sheet.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls"
          required
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm"
        />
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Reading sheet…" : hasSheet ? "Replace from sheet" : "Build claim from sheet"}
        </button>
        {result && <span className={`text-sm ${result.ok ? "text-emerald-200" : "text-red-300"}`}>{result.message}</span>}
      </div>
      {result?.warnings && result.warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-stone-400">
          {result.warnings.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </form>
  );
}
