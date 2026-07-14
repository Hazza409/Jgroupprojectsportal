"use client";

import { useRef, useState, useTransition } from "react";
import { changePassword, type ChangePasswordResult } from "./actions";

export function ChangePasswordForm() {
  const [result, setResult] = useState<ChangePasswordResult | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await changePassword(formData);
      setResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="card grid max-w-md gap-3">
      <div>
        <label className="label">Current password</label>
        <input name="currentPassword" type="password" autoComplete="current-password" className="input" required />
      </div>
      <div>
        <label className="label">New password</label>
        <input name="newPassword" type="password" autoComplete="new-password" className="input" required minLength={10} />
        <p className="mt-1 text-xs text-stone-400">At least 10 characters. Use something long and unique.</p>
      </div>
      <div>
        <label className="label">Confirm new password</label>
        <input name="confirmPassword" type="password" autoComplete="new-password" className="input" required minLength={10} />
      </div>
      {result && (
        <p className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>
          {result.message}
        </p>
      )}
      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Updating…" : "Update password"}
        </button>
      </div>
    </form>
  );
}
