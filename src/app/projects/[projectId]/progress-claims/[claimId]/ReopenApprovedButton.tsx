"use client";

import { useState, useTransition } from "react";
import { runAction } from "@/lib/actionResult";
import { reopenApprovedClaim } from "../actions";

/**
 * Take an approved claim back to draft so it can be corrected.
 *
 * Deliberately the least convenient control on the page. Approved claims are
 * the figures a client signed off on, and nothing here should make unwinding
 * one feel routine — so it asks for a written reason before it will do
 * anything, and says plainly that the reversal goes on the record.
 */
export function ReopenApprovedButton({
  projectId,
  claimId,
  claimNumber,
}: {
  projectId: string;
  claimId: string;
  claimNumber: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function go() {
    const form = new FormData();
    form.set("reason", reason);
    startTransition(async () => {
      const res = await runAction(() => reopenApprovedClaim(projectId, claimId, form));
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) setOpen(false);
    });
  }

  if (!open) {
    return (
      <>
        <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
          Reopen for correction
        </button>
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>
            {msg.text}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
      <p className="text-sm">
        This takes Claim #{claimNumber} back to draft and withdraws its cost postings. The approval already
        recorded stays on the Decision Register, and this reversal is added after it — naming you, the time,
        and what the claim was worth.
      </p>
      <label className="block">
        <span className="label">Why is it being reopened?</span>
        <input
          className="input w-full"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          placeholder="e.g. reconciliation sheet corrected — four invoices moved to a later claim"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={pending || !reason.trim()} onClick={go}>
          {pending ? "Reopening…" : "Reopen and record it"}
        </button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {msg && !msg.ok && <p className="text-sm text-red-700 dark:text-red-300">{msg.text}</p>}
    </div>
  );
}
