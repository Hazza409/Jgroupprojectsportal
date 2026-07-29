"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setForecasts, signOffForecast, type SimpleResult } from "@/app/projects/[projectId]/actions";
import { DateField } from "@/components/DateField";

export interface ForecastGateView {
  required: string[];
  signed: { email: string; name: string; at: string }[];
  outstanding: string[];
  complete: boolean;
  hasPending: boolean;
  warning: string | null;
  unconfigured: boolean;
  unmatched: string[];
}

// Builder-only entry + sign-off for the two headline forecast figures.
// Figures are TYPED IN from Nick's fortnightly numbers (the portal
// never calculates them) and are STAGED until the approver signs — nothing
// reaches the client before that.
export function ForecastCard({
  projectId,
  pendingCostDollars,
  pendingDate,
  pendingCostNote,
  pendingDateNote,
  publishedSummary,
  publishedAt,
  publishedBy,
  gate,
  canSign,
}: {
  projectId: string;
  pendingCostDollars: string;
  pendingDate: string;
  pendingCostNote: string;
  pendingDateNote: string;
  publishedSummary: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  gate: ForecastGateView;
  canSign: boolean;
}) {
  const [result, setResult] = useState<SimpleResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(fn: () => Promise<SimpleResult>) {
    startTransition(async () => {
      const res = await fn();
      setResult(res);
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="font-semibold">Fortnightly forecast figures</h3>
        <p className="mt-0.5 text-xs text-stone-500">
          Enter the figures confirmed by Nick — the portal never calculates these. Figures are staged here and only
          reach the client once <strong>sign-off is complete</strong>.
        </p>
      </div>

      {/* What the client can see right now. */}
      <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-stone-400">Currently published to client</span>
        <p className="mt-0.5">{publishedSummary ?? "Nothing published yet — the client sees no forecast."}</p>
        {publishedAt && (
          <p className="text-xs text-stone-400">
            Published {publishedAt}
            {publishedBy ? ` · signed off by ${publishedBy}` : ""}
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          run(() => setForecasts(projectId, fd));
        }}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Forecast final cost ($, incl GST)</label>
            <input name="forecastFinalCost" type="number" step="0.01" defaultValue={pendingCostDollars} className="input" placeholder="0.00" />
          </div>
          <div>
            <label className="label">Forecast completion date</label>
            <DateField name="forecastCompletionDate" defaultValue={pendingDate} />
          </div>
          <div>
            <label className="label">Reason for cost movement (optional)</label>
            <input name="forecastFinalCostNote" defaultValue={pendingCostNote} className="input" placeholder="e.g. Stone selection uplift" />
          </div>
          <div>
            <label className="label">Reason for date movement (optional)</label>
            <input name="forecastCompletionNote" defaultValue={pendingDateNote} className="input" placeholder="e.g. 2 weeks weather delay" />
          </div>
        </div>
        <button type="submit" className="btn-ghost" disabled={pending}>
          {pending ? "Saving…" : "Stage figures for sign-off"}
        </button>
      </form>

      {/* The gate. */}
      <div className="border-t border-stone-200 pt-3">
        {gate.warning && <p className="mb-2 text-sm text-amber-700 dark:text-amber-300">⚠ {gate.warning}</p>}
        {!gate.hasPending ? (
          <p className="text-xs text-stone-400">
            No figures staged.{gate.required.length > 0 ? ` Approvers: ${gate.required.join(", ")}.` : ""}
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-stone-400">Sign-off required before publishing</p>
            <ul className="space-y-1 text-sm">
              {gate.unconfigured ? (
                gate.signed.length > 0 ? (
                  gate.signed.map((s) => (
                    <li key={s.email} className="text-emerald-700 dark:text-emerald-300">✓ {s.name} — signed {s.at}</li>
                  ))
                ) : (
                  <li className="text-stone-500">○ Awaiting a staff sign-off</li>
                )
              ) : (
                gate.required.map((email) => {
                  const sig = gate.signed.find((s) => s.email === email);
                  return (
                    <li key={email} className={sig ? "text-emerald-700 dark:text-emerald-300" : "text-stone-500"}>
                      {sig ? `✓ ${sig.name} — signed ${sig.at}` : `○ ${email} — awaiting sign-off`}
                    </li>
                  );
                })
              )}
            </ul>
            {canSign ? (
              <button type="button" className="btn-primary" disabled={pending} onClick={() => run(() => signOffForecast(projectId))}>
                {pending ? "Signing…" : "Sign off these figures"}
              </button>
            ) : (
              <p className="text-xs text-stone-400">
                You are not a configured approver, so you cannot sign these off.
              </p>
            )}
          </div>
        )}
      </div>

      {result && (
        <p className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
