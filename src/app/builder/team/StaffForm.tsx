"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStaff, type StaffResult } from "./actions";

export function StaffForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<StaffResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createStaff(form);
      setResult(res);
      if (res.ok) {
        formRef.current?.reset();
        router.refresh();
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="card space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Add project manager</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" name="name" className="input" required placeholder="Jordan Smith" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" className="input" required placeholder="jordan@jgroup.com" />
        </div>
        <div>
          <label className="label" htmlFor="password">Temporary password</label>
          <input id="password" name="password" type="text" className="input" required placeholder="min 8 characters" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create login"}
        </button>
        {result && (
          <span className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>{result.message}</span>
        )}
      </div>
    </form>
  );
}
