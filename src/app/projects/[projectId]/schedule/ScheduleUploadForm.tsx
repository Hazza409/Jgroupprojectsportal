"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importSchedule, type ImportResult } from "./actions";

export function ScheduleUploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await importSchedule(projectId, form);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <p className="mb-3 text-sm text-stone-600">
        Upload the fortnightly schedule (.xlsx). Expected columns: <code>Task</code>,{" "}
        <code>Start</code>, <code>Finish</code>, <code>% Complete</code>. See{" "}
        <code>examples/sample-schedule.xlsx</code>. Re-importing replaces the current schedule.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" name="file" accept=".xlsx,.xls" required className="text-sm" />
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Importing…" : "Import schedule"}
        </button>
      </div>
      {result && (
        <p className={`mt-3 text-sm ${result.ok ? "text-brand" : "text-red-600"}`}>{result.message}</p>
      )}
    </form>
  );
}
