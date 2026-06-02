"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addScheduleTask, type ImportResult } from "./actions";

export function AddTaskForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await addScheduleTask(projectId, form);
      setResult(res);
      if (res.ok) {
        formRef.current?.reset();
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        + Add task manually
      </button>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-1">
          <label className="label">Phase / trade</label>
          <input name="group" className="input" placeholder="Framing" />
        </div>
        <div className="lg:col-span-2">
          <label className="label">Task</label>
          <input name="taskName" className="input" required placeholder="Install windows Lvl 3" />
        </div>
        <div>
          <label className="label">Start</label>
          <input name="startDate" type="date" className="input" />
        </div>
        <div>
          <label className="label">Finish</label>
          <input name="endDate" type="date" className="input" />
        </div>
      </div>
      <div className="flex items-end gap-3">
        <div className="w-32">
          <label className="label">% complete</label>
          <input name="percentComplete" type="number" min={0} max={100} className="input" placeholder="0" />
        </div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Adding…" : "Add task"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        {result && <span className={`text-sm ${result.ok ? "text-emerald-200" : "text-red-300"}`}>{result.message}</span>}
      </div>
    </form>
  );
}
