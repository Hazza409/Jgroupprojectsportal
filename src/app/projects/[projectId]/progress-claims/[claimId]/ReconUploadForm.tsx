"use client";

import { runAction } from "@/lib/actionResult";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importReconSheet, listClaimReconTabs, type ReconImportResult } from "../actions";

/**
 * Build (or rebuild) a claim from the reconciliation sheet.
 *
 * Two steps, for the same reason the claim-history import is two steps: a
 * running workbook holds every month of the job. Submitting it in one go meant
 * the parser fell back to the highest invoice number, so rebuilding claim #5
 * from the full workbook quietly built it out of claim #6's figures. The
 * builder picks the tab; the app never guesses which month was meant.
 */
export function ReconUploadForm({
  projectId,
  claimId,
  hasSheet,
  claimNumber,
}: {
  projectId: string;
  claimId: string;
  hasSheet: boolean;
  claimNumber: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [tabs, setTabs] = useState<{ name: string; invoiceNumber: number }[] | null>(null);
  const [tab, setTab] = useState("");
  const [result, setResult] = useState<ReconImportResult | null>(null);

  function readTabs() {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      const res = await runAction(() => listClaimReconTabs(projectId, form));
      setResult(res.ok ? null : res);
      if (res.ok && "tabs" in res && res.tabs) {
        setTabs(res.tabs);
        // Default to the tab whose number matches this claim — right far more
        // often than not, and visible so it can be overridden.
        const match = res.tabs.find((t) => t.invoiceNumber === claimNumber);
        setTab(match?.name ?? res.tabs[0]?.name ?? "");
      }
    });
  }

  function build() {
    if (!file || !tab) return;
    const form = new FormData();
    form.set("file", file);
    form.set("tab", tab);
    startTransition(async () => {
      const res = await runAction(() => importReconSheet(projectId, claimId, form));
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div>
      <p className="mb-3 text-sm text-stone-500">
        Upload the reconciliation sheet (.xlsx) — it builds this claim: line items, supplier backup,
        labour, builder&apos;s margin and GST. Re-uploading replaces everything from the sheet.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0] ?? null;
            setFile(f);
            setTabs(null);
            setTab("");
            setResult(null);
          }}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm"
        />
        {!tabs && (
          <button type="button" className="btn-ghost" disabled={pending || !file} onClick={readTabs}>
            {pending ? "Reading…" : "Read the workbook"}
          </button>
        )}
        {tabs && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <span className="whitespace-nowrap text-stone-500">Build from</span>
              <select
                className="input min-w-[14rem]"
                value={tab}
                disabled={pending}
                onChange={(e) => setTab(e.currentTarget.value)}
              >
                {tabs.map((t) => (
                  <option key={t.name} value={t.name}>
                    #{t.invoiceNumber} — {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-primary" disabled={pending || !tab} onClick={build}>
              {pending ? "Reading sheet…" : hasSheet ? "Replace from sheet" : "Build claim from sheet"}
            </button>
          </>
        )}
        {result && (
          <span className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>
            {result.message}
          </span>
        )}
      </div>
      {result?.warnings && result.warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-stone-400">
          {result.warnings.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}
