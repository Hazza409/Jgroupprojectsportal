"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAction } from "@/lib/actionResult";
import { formatCents } from "@/lib/money";
import {
  importClaimHistory,
  previewClaimHistory,
  type ClaimHistoryResult,
  type ClaimHistoryTab,
} from "./actions";

/**
 * Bring a mid-build job's invoice history in from its reconciliation workbook,
 * one claim per tab. The current invoice is deliberately excluded by default:
 * it is still being built in the spreadsheet and should be raised as a live
 * claim, not carried in as settled history.
 */
export function ClaimHistoryImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [tabs, setTabs] = useState<ClaimHistoryTab[] | null>(null);
  const [upTo, setUpTo] = useState<string>("");
  const [result, setResult] = useState<ClaimHistoryResult | null>(null);

  function reset() {
    setOpen(false);
    setFile(null);
    setTabs(null);
    setUpTo("");
    setResult(null);
  }

  function read() {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    start(async () => {
      const res = await runAction(() => previewClaimHistory(projectId, form));
      setResult(res.ok ? null : (res as ClaimHistoryResult));
      const list = "tabs" in res ? res.tabs : undefined;
      if (res.ok && list && list.length > 0) {
        setTabs(list);
        // Default to the second-newest: the newest is the invoice still open.
        const nums = list.map((t) => t.invoiceNumber).sort((a, b) => b - a);
        setUpTo(String(nums[1] ?? nums[0]));
      }
    });
  }

  function commit() {
    if (!file || !upTo) return;
    const form = new FormData();
    form.set("file", file);
    form.set("upTo", upTo);
    start(async () => {
      const res = await runAction(() => importClaimHistory(projectId, form));
      setResult(res as ClaimHistoryResult);
      if (res.ok) {
        setTabs(null);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        Bring in claim history
      </button>
    );
  }

  const selected = tabs?.filter((t) => t.invoiceNumber <= Number(upTo)) ?? [];
  const newCount = selected.filter((t) => !t.exists).length;
  const selectedTotal = selected.filter((t) => !t.exists).reduce((a, t) => a + t.totalCents, 0);
  const fixed = selected.filter((t) => t.dateFixed).length;
  const warnings = result?.warnings ?? [];

  return (
    <div className="card w-full space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Bring in claim history</h3>
        <p className="mt-1 text-sm text-stone-500">
          For a job that ran before it was on the dashboard. Every invoice tab in the reconciliation workbook
          becomes an approved progress claim, dated when it was actually raised, with its cost-code split and
          supplier backup. Each month&apos;s figures come from that month&apos;s <code>Current</code> column, so
          the total reconciles to what was invoiced rather than to a running total that may have drifted.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".xlsx,.xls"
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0] ?? null;
            setFile(f);
            setTabs(null);
            setResult(null);
          }}
        />
        {!tabs && (
          <button type="button" className="btn-primary" disabled={pending || !file} onClick={read}>
            {pending ? "Reading…" : "Read the workbook"}
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={reset}>
          {result?.ok ? "Close" : "Cancel"}
        </button>
      </div>

      {tabs && tabs.length > 0 && (
        <div className="space-y-3 border-t border-stone-200 pt-3 dark:border-stone-700">
          <label className="block sm:max-w-xs">
            <span className="label">Bring in invoices up to and including</span>
            <select className="input" value={upTo} onChange={(e) => setUpTo(e.currentTarget.value)}>
              {tabs
                .slice()
                .sort((a, b) => b.invoiceNumber - a.invoiceNumber)
                .map((t) => (
                  <option key={t.invoiceNumber} value={t.invoiceNumber}>
                    #{t.invoiceNumber} — {t.periodLabel ?? t.tab}
                    {t.exists ? " (already a claim)" : ""}
                  </option>
                ))}
            </select>
          </label>

          <div className="rounded-md border border-stone-200 p-3 text-sm dark:border-stone-700">
            <p>
              <strong>{newCount}</strong> claim{newCount === 1 ? "" : "s"} will be created, totalling{" "}
              <strong className="tabular-nums">{formatCents(selectedTotal)}</strong> invoiced (inc margin &amp; GST).
            </p>
            <p className="mt-1 text-stone-500">
              They land as <strong>approved</strong>, dated when each was raised. The Decision Register records
              each as carried in at onboarding rather than decided in the portal.
            </p>
            {fixed > 0 && (
              <p className="mt-1 text-amber-700 dark:text-amber-300">
                {fixed} date{fixed === 1 ? "" : "s"} ran backwards against the previous invoice and will be
                corrected by swapping day and month.
              </p>
            )}
            <p className="mt-1 text-stone-500">
              Any carried-in opening position is removed first — it is the same money in aggregate, and keeping
              both would count every month twice.
            </p>
          </div>

          <div className="max-h-52 overflow-y-auto rounded-md border border-stone-200 dark:border-stone-700">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-stone-50 text-left uppercase tracking-wide text-stone-400">
                <tr>
                  <th className="px-2 py-1.5">Inv</th>
                  <th className="px-2 py-1.5">Period</th>
                  <th className="px-2 py-1.5">Date</th>
                  <th className="px-2 py-1.5 text-right">Codes</th>
                  <th className="px-2 py-1.5 text-right">Suppliers</th>
                  <th className="px-2 py-1.5 text-right">Invoiced</th>
                </tr>
              </thead>
              <tbody>
                {selected
                  .slice()
                  .sort((a, b) => b.invoiceNumber - a.invoiceNumber)
                  .map((t) => (
                    <tr key={t.invoiceNumber} className="border-t border-stone-100 dark:border-stone-800">
                      <td className="px-2 py-1 tabular-nums">#{t.invoiceNumber}</td>
                      <td className="px-2 py-1">{t.periodLabel ?? "—"}</td>
                      <td className="px-2 py-1 tabular-nums">
                        {t.date ?? "—"}
                        {t.dateFixed && <span className="ml-1 text-amber-700 dark:text-amber-300">corrected</span>}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.costCodes}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.suppliers}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCents(t.totalCents)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <button type="button" className="btn-primary" disabled={pending || newCount === 0} onClick={commit}>
            {pending ? "Bringing in…" : `Bring in ${newCount} claim${newCount === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {result && (
        <p className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>
          {result.message}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
