"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAction } from "@/lib/actionResult";
import { deleteVariation } from "./actions";

/**
 * Builder-only delete. The confirmation names the variation and says what the
 * client has seen of it, because those are the two things that decide whether
 * deleting is harmless or is removing something the client has been shown.
 * Approved and rejected variations are refused by the action itself — this is
 * a convenience, not the boundary.
 */
export function DeleteVariationButton({
  projectId,
  variationId,
  variationNumber,
  title,
  status,
}: {
  projectId: string;
  variationId: string;
  variationNumber: number;
  title: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to offer on a decided variation: the action refuses it, and a
  // button that always fails is worse than no button.
  if (status === "APPROVED" || status === "REJECTED") return null;

  function onDelete() {
    setError(null);
    start(async () => {
      const res = await runAction(() => deleteVariation(projectId, variationId));
      if (res.ok) {
        router.push(`/projects/${projectId}/variations`);
        router.refresh();
      } else {
        setConfirming(false);
        setError(res.message);
      }
    });
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        <button type="button" className="btn-ghost text-sm" onClick={() => setConfirming(true)}>
          Delete variation
        </button>
        {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="text-sm text-amber-800 dark:text-amber-200">
        <p className="font-medium">
          Delete variation #{variationNumber} — {title}?
        </p>
        {status === "SUBMITTED" ? (
          <p className="mt-1">
            This one is with the client for a decision. Deleting it removes the variation and its line items,
            and records the withdrawal in the Decision Register so the trail still shows it was raised and
            pulled.
          </p>
        ) : (
          <p className="mt-1">
            It&apos;s a draft, so the client has never seen it. The variation and its line items go for good.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary !bg-red-700 text-sm" disabled={pending} onClick={onDelete}>
          {pending ? "Deleting…" : "Delete it"}
        </button>
        <button type="button" className="btn-ghost text-sm" disabled={pending} onClick={() => setConfirming(false)}>
          Keep it
        </button>
      </div>
    </div>
  );
}
