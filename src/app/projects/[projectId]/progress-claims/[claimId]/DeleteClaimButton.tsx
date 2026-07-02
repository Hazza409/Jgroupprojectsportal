"use client";

import { useTransition } from "react";
import { deleteClaim } from "../actions";

export function DeleteClaimButton({ projectId, claimId, claimNumber }: { projectId: string; claimId: string; claimNumber: number }) {
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (!window.confirm(`Delete Claim #${claimNumber}? This removes its lines, recon detail and uploaded invoices. This can't be undone.`)) return;
    startTransition(async () => {
      await deleteClaim(projectId, claimId);
    });
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={pending}
      className="text-sm text-red-700 dark:text-red-300 hover:text-red-200"
    >
      {pending ? "Deleting…" : "Delete claim"}
    </button>
  );
}
