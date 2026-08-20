"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOffForecast } from "@/app/projects/[projectId]/actions";
import { runAction } from "@/lib/actionResult";

export interface StagedItem {
  /** e.g. "105 Scaffold" or "Forecast final cost". */
  label: string;
  /** Display amount ("$146,000.00") or date. */
  value: string;
  note: string | null;
}

/**
 * Approve staged forecast figures WHERE THEY WERE STAGED.
 *
 * The gate itself lives in Settings, but making that the only place to sign
 * meant staging on one page and publishing from another — in practice things
 * sat staged because the second step was elsewhere. Same action, same
 * revision-fingerprint rules; this is only a second doorway to it.
 */
export function ForecastSignOffCard({
  projectId,
  staged,
  canSign,
  warning,
  outstanding,
}: {
  projectId: string;
  staged: StagedItem[];
  canSign: boolean;
  /** The unconfigured/unmatched notice from the gate, when present. */
  warning: string | null;
  /** Approver emails still to sign (empty in unconfigured mode). */
  outstanding: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function sign() {
    startTransition(async () => {
      const res = await runAction(() => signOffForecast(projectId));
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="card border-amber-500/40 bg-amber-500/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          {staged.length} staged change{staged.length === 1 ? "" : "s"} awaiting sign-off
        </p>
        <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
          The client sees none of this until it&apos;s signed off.
        </p>
      </div>

      <ul className="mt-3 divide-y divide-amber-500/20">
        {staged.map((s) => (
          <li key={s.label} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1">
              {s.label}
              {s.note && <span className="text-stone-500"> — {s.note}</span>}
            </span>
            <span className="tabular-nums font-medium">{s.value}</span>
          </li>
        ))}
      </ul>

      {warning && <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">⚠ {warning}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canSign ? (
          <button type="button" className="btn-primary" onClick={sign} disabled={pending}>
            {pending ? "Signing…" : "Sign off & publish to client"}
          </button>
        ) : (
          <p className="text-xs text-stone-500">
            Awaiting sign-off from {outstanding.join(", ")} — you are not a configured approver.
          </p>
        )}
        {msg && (
          <span
            className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}
            role={msg.ok ? undefined : "alert"}
          >
            {msg.text}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-amber-900/70 dark:text-amber-100/70">
        Signing publishes every staged change in this revision — the line forecasts above and any staged
        headline figures — and records your name and the time. Editing anything staged voids the signature.
      </p>
    </div>
  );
}
