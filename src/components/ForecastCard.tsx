"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setForecasts, type SimpleResult } from "@/app/projects/[projectId]/actions";

// Builder-only entry for the two headline forecast figures (Jake §3).
// These are TYPED IN from Nick & Andrew's fortnightly figures — the portal
// never calculates them.
export function ForecastCard({
  projectId,
  currentCostDollars,
  currentDate,
  costNote,
  dateNote,
  updatedAt,
  updatedBy,
}: {
  projectId: string;
  currentCostDollars: string;
  currentDate: string;
  costNote: string;
  dateNote: string;
  updatedAt: string | null;
  updatedBy: string | null;
}) {
  const [result, setResult] = useState<SimpleResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await setForecasts(projectId, fd);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3">
      <div>
        <h3 className="font-semibold">Fortnightly forecast figures</h3>
        <p className="mt-0.5 text-xs text-stone-500">
          Enter the figures confirmed by Nick and Andrew. The portal never calculates these — it shows exactly what is
          entered here, with the movement since the previous statement.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Forecast final cost ($, incl GST)</label>
          <input
            name="forecastFinalCost"
            type="number"
            step="0.01"
            defaultValue={currentCostDollars}
            className="input"
            placeholder="0.00"
          />
        </div>
        <div>
          <label className="label">Forecast completion date</label>
          <input name="forecastCompletionDate" type="date" defaultValue={currentDate} className="input" />
        </div>
        <div>
          <label className="label">Reason for cost movement (optional)</label>
          <input name="forecastFinalCostNote" defaultValue={costNote} className="input" placeholder="e.g. Stone selection uplift" />
        </div>
        <div>
          <label className="label">Reason for date movement (optional)</label>
          <input name="forecastCompletionNote" defaultValue={dateNote} className="input" placeholder="e.g. 2 weeks weather delay" />
        </div>
      </div>

      {result && (
        <p className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>
          {result.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save forecast figures"}
        </button>
        {updatedAt && (
          <span className="text-xs text-stone-400">
            Last confirmed {updatedAt}
            {updatedBy ? ` by ${updatedBy}` : ""}
          </span>
        )}
      </div>
    </form>
  );
}
