"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordClaimApproved } from "../actions";

// For onboarding existing projects: record a claim as already approved
// (outside the portal) without notifying the client. One-way, so confirm.
export function MarkApprovedButton({
  projectId,
  claimId,
  claimNumber,
}: {
  projectId: string;
  claimId: string;
  claimNumber: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      !window.confirm(
        `Record Claim #${claimNumber} as already approved?\n\nUse this for historical claims approved before this project was on the portal. The client is NOT notified, the claim's costs post to Cost to Complete, and this can't be undone.`,
      )
    )
      return;
    startTransition(async () => {
      await recordClaimApproved(projectId, claimId);
      router.refresh();
    });
  }

  return (
    <button type="button" onClick={onClick} disabled={pending} className="btn-ghost">
      {pending ? "Recording…" : "Record as approved (historical)"}
    </button>
  );
}
