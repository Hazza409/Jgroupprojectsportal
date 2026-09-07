"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAction } from "@/lib/actionResult";
import { setPaymentStatusForApproved, type ReconImportResult } from "./actions";

/**
 * Correct payment status across a carried-in claim history in one move.
 * Shown only when there is something to correct, so it stays out of the way on
 * a job that is running normally.
 */
export function BulkPaymentStatus({ projectId, pending }: { projectId: string; pending: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<"INVOICED" | "PAID">("PAID");
  const [result, setResult] = useState<ReconImportResult | null>(null);

  if (pending === 0 && !result) return null;

  function apply() {
    const form = new FormData();
    form.set("paymentStatus", choice);
    start(async () => {
      const res = await runAction(() => setPaymentStatusForApproved(projectId, form));
      setResult(res as ReconImportResult);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="card space-y-3">
      <div>
        <h3 className="text-sm font-semibold">
          {pending} approved claim{pending === 1 ? "" : "s"} still read &ldquo;not yet invoiced&rdquo;
        </h3>
        <p className="mt-1 text-sm text-stone-500">
          Claims carried in from a job&apos;s history were billed long ago, but every claim starts at
          &ldquo;not yet invoiced&rdquo;. Left as they are, the client sees approved work that appears never to
          have been billed. Each claim is dated from its own invoice, not from today.
        </p>
      </div>

      {!open ? (
        <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
          Correct payment status
        </button>
      ) : (
        <div className="space-y-3 border-t border-stone-200 pt-3 dark:border-stone-700">
          <label className="block sm:max-w-xs">
            <span className="label">These claims were</span>
            <select
              className="input"
              value={choice}
              onChange={(e) => setChoice(e.currentTarget.value as "INVOICED" | "PAID")}
            >
              <option value="PAID">invoiced and paid</option>
              <option value="INVOICED">invoiced, not yet paid</option>
            </select>
          </label>
          {choice === "PAID" && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              The reconciliation sheet records when each claim was raised, not when it settled, so the payment
              date is taken as the invoice date. Correct any that matter on the claim itself.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={apply}>
              {busy ? "Updating…" : `Update ${pending} claim${pending === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <p className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>
          {result.message}
        </p>
      )}
      {(result?.warnings?.length ?? 0) > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          {result!.warnings!.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
