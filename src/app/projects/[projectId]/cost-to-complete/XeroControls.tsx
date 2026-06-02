"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncXero, type SyncResult } from "./actions";

export function XeroControls({
  projectId,
  connected,
  lastSyncedAt,
}: {
  projectId: string;
  connected: boolean;
  lastSyncedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncResult | null>(null);

  function onSync() {
    startTransition(async () => {
      const res = await syncXero(projectId);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {connected ? (
          <>
            <span className="badge bg-green-100 text-green-800">Xero connected</span>
            <button onClick={onSync} className="btn-ghost" disabled={pending}>
              {pending ? "Syncing…" : "Sync now"}
            </button>
          </>
        ) : (
          <a href={`/api/xero/connect?projectId=${projectId}`} className="btn-primary">
            Connect Xero
          </a>
        )}
      </div>
      {lastSyncedAt && <p className="text-xs text-stone-400">Last synced {lastSyncedAt}</p>}
      {result && <p className={`text-xs ${result.ok ? "text-brand" : "text-red-600"}`}>{result.message}</p>}
    </div>
  );
}
