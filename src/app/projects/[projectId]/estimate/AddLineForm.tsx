"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addEstimateLine, type ImportResult } from "./actions";

export function AddLineForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await addEstimateLine(projectId, form);
      setResult(res);
      if (res.ok) {
        formRef.current?.reset();
        router.refresh();
      }
    });
  }

  if (!open) {
    return <button className="btn-ghost" onClick={() => setOpen(true)}>+ Add line manually</button>;
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="card grid items-end gap-3 sm:grid-cols-[90px_1fr_70px_80px_120px_auto]">
      <div>
        <label className="label">Code</label>
        <input name="code" className="input" placeholder="1015" />
      </div>
      <div>
        <label className="label">Description</label>
        <input name="description" className="input" required placeholder="Concreting" />
      </div>
      <div>
        <label className="label">Qty</label>
        <input name="quantity" type="number" step="any" className="input" defaultValue={1} />
      </div>
      <div>
        <label className="label">Unit</label>
        <input name="unit" className="input" placeholder="item" />
      </div>
      <div>
        <label className="label">Unit cost ($)</label>
        <input name="unitCost" type="number" step="0.01" className="input" placeholder="0.00" />
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? "…" : "Add"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {result && <p className={`sm:col-span-6 text-sm ${result.ok ? "text-emerald-200" : "text-red-300"}`}>{result.message}</p>}
    </form>
  );
}
