"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAction } from "@/lib/actionResult";
import { setCostCodeAlias } from "../cost-to-complete/actions";

export interface UnallocatedGroup {
  /** The reconciliation sheet's own wording — what the alias is keyed on. */
  label: string;
  /** Already grossed and formatted on the server; this component does no money maths. */
  amount: string;
  /** Which claims the money came from, e.g. "claims #1, #2 and #4". */
  where: string;
}

/**
 * Point unallocated spend at a budget line.
 *
 * The alias mechanism existed before this, but the only way to reach it was
 * part-way through an opening-position import — so a job whose spend arrived
 * as progress claims had money with nowhere to go and no control to move it.
 * On the Horse Arena that was $726,928.18 of a $1.78m job, stranded because
 * the reconciliation sheet books the shed to "External Labour Hire" while the
 * estimate calls it Structural Steel. The fix was never to edit one document
 * to suit the other.
 *
 * Grouped by source name rather than listed per claim: the same wording
 * usually appears on several months, and mapping it is one decision, not one
 * per claim.
 */
export function UnallocatedMapper({
  projectId,
  groups,
  codes,
}: {
  projectId: string;
  groups: UnallocatedGroup[];
  codes: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function map(label: string, costCodeId: string) {
    // Read the value BEFORE the transition: inside the callback the event has
    // been pooled and currentTarget is null.
    setChosen((m) => ({ ...m, [label]: costCodeId }));
    const form = new FormData();
    form.set("sourceLabel", label);
    form.set("costCodeId", costCodeId);
    startTransition(async () => {
      const res = await runAction(() => setCostCodeAlias(projectId, form));
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) router.refresh();
    });
  }

  if (codes.length === 0) {
    return (
      <p className="mt-1 text-sm text-stone-500">
        Import the estimate first — there are no budget lines to map these onto yet.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-sm text-stone-500">
        These parsed fine but their names match no cost code on this job. Point each at the budget line it
        belongs to — pick the same code twice to merge. The mapping is remembered, so next month&apos;s claim
        matches without asking.
      </p>
      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={g.label} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-[14rem] flex-1">
              {g.label}
              <span className="ml-2 text-xs text-stone-400">{g.where}</span>
            </span>
            <span className="whitespace-nowrap tabular-nums text-stone-500">{g.amount}</span>
            <select
              className="input min-w-[15rem]"
              defaultValue={chosen[g.label] ?? ""}
              disabled={pending}
              onChange={(e) => map(g.label, e.currentTarget.value)}
            >
              <option value="">— leave unallocated —</option>
              {codes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      {msg && (
        <p className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
