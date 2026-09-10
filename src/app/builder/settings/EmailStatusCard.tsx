"use client";

import { useState, useTransition } from "react";
import { runAction } from "@/lib/actionResult";
import { sendNotificationTest } from "./actions";

/**
 * Whether notifications actually send, and proof either way.
 *
 * Without this the only way to know was to read the server log. This app ran
 * for weeks writing every notification to the console because a mail password
 * could not be created, and nothing on screen said so — a client could be
 * waiting on an email that was never going to arrive.
 */
export function EmailStatusCard({
  driver,
  sends,
  detail,
  defaultTo,
}: {
  driver: string;
  sends: boolean;
  detail: string;
  defaultTo: string;
}) {
  const [to, setTo] = useState(defaultTo);
  const [busy, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function test() {
    const form = new FormData();
    form.set("to", to);
    start(async () => {
      const res = await runAction(() => sendNotificationTest(form));
      setResult({ ok: res.ok, message: res.message });
    });
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Notifications</h2>
        <p className="mt-1 text-sm text-stone-500">
          Clients are emailed when a claim or variation is issued to them, a site update is posted, a
          question is raised or a meeting is set. The team is emailed when a client approves or{" "}
          <strong>rejects</strong> a claim or variation, answers a question, or responds to a meeting.
        </p>
      </div>

      <div
        className={`rounded-md border p-3 text-sm ${
          sends
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
            : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
        }`}
      >
        <p className="font-medium">
          {sends ? `Sending — ${driver}` : `Not sending — ${driver}`}
        </p>
        <p className="mt-1">{detail}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">Send a test to</span>
          <input
            type="email"
            className="input min-w-[16rem]"
            value={to}
            onChange={(e) => setTo(e.currentTarget.value)}
            placeholder="you@example.com"
          />
        </label>
        <button type="button" className="btn-ghost" disabled={busy || !to} onClick={test}>
          {busy ? "Sending…" : "Send test"}
        </button>
      </div>

      {result && (
        <p className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
