"use client";

import { runAction } from "@/lib/actionResult";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/money";
import { importOpeningPosition, listOpeningTabs, setCostCodeAlias, type OpeningPositionResult } from "./actions";

/**
 * Carry a part-built job's spend-to-date in from the running reconciliation
 * sheet. Two steps on purpose: a job's workbook holds every month of its life,
 * and picking the wrong tab imports the wrong position, so the builder chooses
 * which invoice the position is taken at rather than the app guessing.
 */
export function OpeningPositionImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [tabs, setTabs] = useState<{ name: string; invoiceNumber: number | null }[] | null>(null);
  const [tab, setTab] = useState("");
  const [result, setResult] = useState<OpeningPositionResult | null>(null);
  const [mapped, setMapped] = useState<Record<string, string>>({});
  const [mapMsg, setMapMsg] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setFile(null);
    setTabs(null);
    setTab("");
    setResult(null);
    setMapped({});
    setMapMsg(null);
  }

  function mapLine(sourceLabel: string, costCodeId: string) {
    setMapped((m) => ({ ...m, [sourceLabel]: costCodeId }));
    const form = new FormData();
    form.set("sourceLabel", sourceLabel);
    form.set("costCodeId", costCodeId);
    startTransition(async () => {
      const res = await runAction(() => setCostCodeAlias(projectId, form));
      setMapMsg(res.message);
      if (res.ok) router.refresh();
    });
  }

  function readTabs() {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      const res = await runAction(() => listOpeningTabs(projectId, form));
      setResult(res.ok ? null : res);
      if (res.ok && "tabs" in res && res.tabs) {
        setTabs(res.tabs);
        setTab(res.tabs[0]?.name ?? "");
      }
    });
  }

  function carryAcross() {
    if (!file || !tab) return;
    const form = new FormData();
    form.set("file", file);
    form.set("tab", tab);
    startTransition(async () => {
      const res = await runAction(() => importOpeningPosition(projectId, form));
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  if (!open) {
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        Carry in a mid-job position
      </button>
    );
  }

  const warnings = result?.warnings ?? [];
  const unmatched = result?.unmatched ?? [];
  const codes = result?.codes ?? [];

  return (
    <div className="card w-full max-w-3xl space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Carry in a mid-job position</h3>
        <p className="mt-1 text-sm text-stone-500">
          For a job that started before it was on the dashboard. Upload the running reconciliation sheet and
          pick the invoice the position is taken at — the <code>To Date</code> column becomes the spend
          against each cost code, so the whole history arrives in one move instead of replaying every claim.
          Import the estimate first: the position is matched against the approved budget&apos;s cost codes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".xlsx,.xls"
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm"
          onChange={(e) => {
            setFile(e.currentTarget.files?.[0] ?? null);
            setTabs(null);
            setResult(null);
          }}
        />
        {!tabs && (
          <button type="button" className="btn-primary" disabled={pending || !file} onClick={readTabs}>
            {pending ? "Reading…" : "Read tabs"}
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={reset}>
          {result?.ok ? "Close" : "Cancel"}
        </button>
      </div>

      {tabs && (
        <div className="flex flex-wrap items-end gap-3 border-t border-stone-200 pt-3 dark:border-stone-700">
          <label className="block">
            <span className="label">Position taken at</span>
            <select className="input min-w-[16rem]" value={tab} onChange={(e) => setTab(e.currentTarget.value)}>
              {tabs.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-primary" disabled={pending || !tab} onClick={carryAcross}>
            {pending ? "Carrying across…" : "Carry across"}
          </button>
          <p className="w-full text-xs text-stone-400">
            Replaces any position carried in before, and any manual cost import — those mean the same thing and
            would otherwise stack. Enter claims only for periods after the invoice you pick here.
          </p>
        </div>
      )}

      {result && (
        <p
          className={`text-sm ${
            result.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"
          }`}
        >
          {result.message}
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {unmatched.length > 0 && codes.length > 0 && (
        <div className="space-y-2 border-t border-stone-200 pt-3 dark:border-stone-700">
          <div>
            <h4 className="text-sm font-semibold">Lines with no budget code</h4>
            <p className="mt-1 text-sm text-stone-500">
              These are showing as Unallocated. Point each one at the budget line it belongs to — pick the same
              code for two rows to merge them. The mapping is remembered, so later imports match it without
              asking.
            </p>
          </div>
          <ul className="space-y-2">
            {unmatched.map((u) => (
              <li key={u.label} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-[15rem] flex-1">{u.label}</span>
                <span className="tabular-nums whitespace-nowrap text-stone-500">{formatCents(u.cents)}</span>
                <select
                  className="input min-w-[15rem]"
                  defaultValue={mapped[u.label] ?? ""}
                  disabled={pending}
                  onChange={(e) => mapLine(u.label, e.currentTarget.value)}
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
          {mapMsg && <p className="text-sm text-emerald-700 dark:text-emerald-200">{mapMsg}</p>}
        </div>
      )}
    </div>
  );
}
