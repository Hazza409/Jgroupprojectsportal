"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadXeroInvoice } from "../actions";

export function InvoiceUploadForm({
  projectId,
  claimId,
  hasInvoice,
}: {
  projectId: string;
  claimId: string;
  hasInvoice: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      await uploadXeroInvoice(projectId, claimId, form);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <input
        type="file"
        name="file"
        accept=".pdf,.png,.jpg,.jpeg"
        required
        className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm"
      />
      <button type="submit" className="btn-ghost" disabled={pending}>
        {pending ? "Uploading…" : hasInvoice ? "Replace invoice" : "Upload Xero invoice"}
      </button>
    </form>
  );
}
