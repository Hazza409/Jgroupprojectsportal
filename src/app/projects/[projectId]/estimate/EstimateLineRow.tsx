"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAction } from "@/lib/actionResult";
import { updateEstimateLine, deleteEstimateLine } from "./actions";

export interface LineRow {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unitCostDollars: string;
  /** Preformatted on the server; this component does no money maths. */
  unitCostLabel: string;
  totalLabel: string;
  costCodeId: string | null;
  codeLabel: string;
  codeNameLabel: string;
}

/**
 * One estimate line, readable until you ask to change it.
 *
 * Editing used to mean re-importing the whole spreadsheet with "replace"
 * ticked — the only route to changing a single rate, and no route at all for a
 * line added by hand. Re-pointing the cost code is the part that earns its
 * keep: it moves a line onto the right budget without editing the estimate at
 * one end or the reconciliation at the other.
 */
export function EstimateLineRow({
  projectId,
  line,
  codes,
  canEdit,
}: {
  projectId: string;
  line: LineRow;
  codes: { id: string; code: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [desc, setDesc] = useState(line.description);
  const [qty, setQty] = useState(String(line.quantity));
  const [unit, setUnit] = useState(line.unit ?? "");
  const [cost, setCost] = useState(line.unitCostDollars);
  const [codeId, setCodeId] = useState(line.costCodeId ?? "");

  function save() {
    const form = new FormData();
    form.set("description", desc);
    form.set("quantity", qty);
    form.set("unit", unit);
    form.set("unitCost", cost);
    form.set("costCodeId", codeId);
    startTransition(async () => {
      const res = await runAction(() => updateEstimateLine(projectId, line.id, form));
      setErr(res.ok ? null : res.message);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  function remove() {
    if (!window.confirm(`Delete "${line.description}"? This changes the estimate total.`)) return;
    startTransition(async () => {
      const res = await runAction(() => deleteEstimateLine(projectId, line.id));
      setErr(res.ok ? null : res.message);
      if (res.ok) router.refresh();
    });
  }

  if (!editing) {
    return (
      <tr>
        <td className="px-2 py-2 font-mono text-xs break-words">{line.codeLabel}</td>
        <td className="px-2 py-2 break-words">{line.codeNameLabel}</td>
        <td className="px-2 py-2 break-words">
          {line.description}
          {err && <span className="ml-2 text-xs text-red-700 dark:text-red-300">{err}</span>}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{line.quantity}</td>
        <td className="px-2 py-2 break-words">{line.unit ?? "—"}</td>
        <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{line.unitCostLabel}</td>
        <td className="px-2 py-2 text-right font-medium tabular-nums whitespace-nowrap">
          {line.totalLabel}
          {canEdit && (
            <button
              type="button"
              className="ml-2 text-xs font-normal text-stone-400 underline underline-offset-2 hover:text-ink"
              onClick={() => setEditing(true)}
            >
              edit
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-amber-500/5">
      <td className="px-2 py-2" colSpan={7}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="label">Cost code</span>
            <select className="input min-w-[13rem]" value={codeId} onChange={(e) => setCodeId(e.currentTarget.value)}>
              <option value="">— unallocated —</option>
              {codes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-[18rem] flex-1">
            <span className="label">Line item</span>
            <input className="input w-full" value={desc} onChange={(e) => setDesc(e.currentTarget.value)} />
          </label>
          <label className="block w-24">
            <span className="label">Qty</span>
            <input className="input w-full" type="number" step="any" value={qty} onChange={(e) => setQty(e.currentTarget.value)} />
          </label>
          <label className="block w-24">
            <span className="label">Unit</span>
            <input className="input w-full" value={unit} onChange={(e) => setUnit(e.currentTarget.value)} />
          </label>
          <label className="block w-36">
            <span className="label">Unit cost</span>
            <input className="input w-full" type="number" step="0.01" value={cost} onChange={(e) => setCost(e.currentTarget.value)} />
          </label>
          <button type="button" className="btn-primary" disabled={pending || !desc.trim()} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn-ghost" disabled={pending} onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="text-sm text-red-700 hover:text-red-200 dark:text-red-300"
            disabled={pending}
            onClick={remove}
          >
            Delete
          </button>
        </div>
        <p className="mt-1 text-xs text-stone-400">
          Amounts are base figures — ex margin and ex GST. The portal adds both at display.
        </p>
        {err && <p className="mt-1 text-sm text-red-700 dark:text-red-300">{err}</p>}
      </td>
    </tr>
  );
}
