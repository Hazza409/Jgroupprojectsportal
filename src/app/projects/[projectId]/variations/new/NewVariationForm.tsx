"use client";

import Link from "next/link";
import { useState } from "react";

type Code = { id: string; code: string; name: string };

// Manual variation creation with MULTIPLE line items. Each row posts parallel
// fields (lineDescription/quantity/unit/unitCost) that the server action zips
// into line items. Rows are added/removed client-side.
export function NewVariationForm({
  action,
  projectId,
  costCodes,
}: {
  action: (formData: FormData) => void | Promise<void>;
  projectId: string;
  costCodes: Code[];
}) {
  const [rows, setRows] = useState<number[]>([0]);
  const [nextId, setNextId] = useState(1);

  const addRow = () => {
    setRows((r) => [...r, nextId]);
    setNextId((n) => n + 1);
  };
  const removeRow = (id: number) => setRows((r) => (r.length > 1 ? r.filter((x) => x !== id) : r));

  return (
    <form action={action} className="card grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label">Title</label>
        <input name="title" className="input" required placeholder="e.g. Upgrade to stone benchtops" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Description (optional)</label>
        <input name="description" className="input" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Adds to cost code (optional — auto-matched from the title if left blank)</label>
        <select name="costCodeId" className="input" defaultValue="">
          <option value="">— Auto-match / Unallocated —</option>
          {costCodes.map((c) => (
            <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className="label">Line items</label>
        <div className="space-y-2">
          {rows.map((id) => (
            <div key={id} className="grid grid-cols-[1fr_4rem_4rem_6rem_auto] items-center gap-2">
              <input name="lineDescription" className="input" placeholder="Line description" />
              <input name="quantity" type="number" step="any" defaultValue={1} className="input" title="Qty" />
              <input name="unit" className="input" placeholder="ea" title="Unit" />
              <input name="unitCost" type="number" step="0.01" className="input" placeholder="$0.00" title="Unit cost" />
              <button
                type="button"
                onClick={() => removeRow(id)}
                className="px-2 text-sm text-stone-400 hover:text-red-500"
                aria-label="Remove line"
                title="Remove line"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addRow} className="btn-ghost mt-2 !px-3 !py-1.5 text-sm">
          + Add another line
        </button>
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
        <button className="btn-primary" type="submit">Create variation</button>
        <Link href={`/projects/${projectId}/variations`} className="btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}
