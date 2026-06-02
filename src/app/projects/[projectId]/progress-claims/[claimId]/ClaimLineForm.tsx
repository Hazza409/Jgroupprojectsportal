"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addClaimLine } from "../actions";

export function ClaimLineForm({
  projectId,
  claimId,
  costCodes,
}: {
  projectId: string;
  claimId: string;
  costCodes: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      await addClaimLine(projectId, claimId, form);
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_90px_130px_auto]">
      <div>
        <label className="label">Cost code</label>
        <select name="costCodeId" className="input">
          <option value="">—</option>
          {costCodes.map((cc) => (
            <option key={cc.id} value={cc.id}>
              {cc.code} · {cc.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Description</label>
        <input name="description" className="input" placeholder="(defaults to cost code)" />
      </div>
      <div>
        <label className="label">% complete</label>
        <input name="percentComplete" type="number" min={0} max={100} className="input" placeholder="0" />
      </div>
      <div>
        <label className="label">Amount claimed ($)</label>
        <input name="claimedAmount" type="number" step="0.01" className="input" placeholder="0.00" />
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Adding…" : "Add line"}
      </button>
    </form>
  );
}
