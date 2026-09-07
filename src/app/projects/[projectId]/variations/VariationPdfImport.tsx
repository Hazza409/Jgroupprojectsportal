"use client";

import { runAction } from "@/lib/actionResult";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/money";
import {
  commitVariationPdfs,
  previewVariationPdfs,
  type PdfImportResult,
  type PdfVariationPreview,
} from "./actions";

/**
 * Import variations straight from the signed PDFs. Two steps: read the
 * documents, then confirm which are approved and when. Approval is never
 * inferred from the file — the signature blocks are blank even on variations
 * the client has agreed to — and the date defaults to the date printed on the
 * document, so a historical approval isn't recorded as though it happened today.
 */
export function VariationPdfImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<PdfVariationPreview[] | null>(null);
  const [approved, setApproved] = useState<Record<number, boolean>>({});
  const [dates, setDates] = useState<Record<number, string>>({});
  const [result, setResult] = useState<PdfImportResult | null>(null);

  function reset() {
    setOpen(false);
    setFiles([]);
    setPreviews(null);
    setApproved({});
    setDates({});
    setResult(null);
  }

  function withFiles(form: FormData) {
    for (const f of files) form.append("files", f);
    return form;
  }

  function read() {
    if (files.length === 0) return;
    startTransition(async () => {
      const res = await runAction(() => previewVariationPdfs(projectId, withFiles(new FormData())));
      setResult(res.ok ? null : res);
      const list = "previews" in res ? res.previews : undefined;
      if (res.ok && list) {
        setPreviews(list);
        // Default every document to approved with its printed date — the common
        // case on an existing job — and let the builder untick the exceptions.
        const a: Record<number, boolean> = {};
        const d: Record<number, string> = {};
        for (const p of list) {
          if (p.number === null || p.existing) continue;
          a[p.number] = true;
          if (p.date) d[p.number] = p.date;
        }
        setApproved(a);
        setDates(d);
      }
    });
  }

  function commit() {
    const form = withFiles(new FormData());
    for (const [num, on] of Object.entries(approved)) {
      if (!on) continue;
      form.set(`approved_${num}`, "1");
      const when = dates[Number(num)];
      if (when) form.set(`approvedOn_${num}`, when);
    }
    startTransition(async () => {
      const res = await runAction(() => commitVariationPdfs(projectId, form));
      setResult(res);
      if (res.ok) {
        setPreviews(null);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        Import from variation PDFs
      </button>
    );
  }

  const importable = (previews ?? []).filter((p) => p.number !== null && !p.existing);
  const approvedTotal = importable
    .filter((p) => p.number !== null && approved[p.number])
    .reduce((a, p) => a + p.clientTotalCents, 0);
  const draftTotal = importable
    .filter((p) => p.number !== null && !approved[p.number])
    .reduce((a, p) => a + p.clientTotalCents, 0);

  return (
    <div className="card w-full space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Import from variation PDFs</h3>
        <p className="mt-1 text-sm text-stone-500">
          Select the variation documents — the whole folder at once is fine. Each keeps the number printed on
          it, so a variation the client knows as V-01025 stays V-01025 here. The document is stored against
          the variation as the evidence for the figure.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".pdf"
          multiple
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm"
          onChange={(e) => {
            setFiles(Array.from(e.currentTarget.files ?? []));
            setPreviews(null);
            setResult(null);
          }}
        />
        {!previews && (
          <button type="button" className="btn-primary" disabled={pending || files.length === 0} onClick={read}>
            {pending ? "Reading…" : `Read ${files.length || ""} document${files.length === 1 ? "" : "s"}`}
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={reset}>
          {result?.ok ? "Close" : "Cancel"}
        </button>
      </div>

      {previews && previews.length > 0 && (
        <div className="space-y-3 border-t border-stone-200 pt-3 dark:border-stone-700">
          <p className="text-sm text-stone-500">
            Untick anything the client hasn&apos;t approved. Approved ones are recorded against the date below —
            the date on the document, not today — and the Decision Register notes the approval was carried in
            at onboarding rather than made in the portal.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400 dark:border-stone-700">
                  <th className="py-2 pr-2">Approved</th>
                  <th className="py-2 pr-2">Ref</th>
                  <th className="py-2 pr-2">Title</th>
                  <th className="py-2 pr-2 text-right">Lines</th>
                  <th className="py-2 pr-2 text-right">Client total</th>
                  <th className="py-2 pr-2">Approved on</th>
                </tr>
              </thead>
              <tbody>
                {previews.map((p) => {
                  const n = p.number;
                  return (
                    <tr key={p.file} className="border-b border-stone-100 last:border-0 dark:border-stone-800">
                      <td className="py-2 pr-2">
                        {n === null || p.existing ? (
                          <span className="text-xs text-stone-400">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={!!approved[n]}
                            onChange={(e) => setApproved((s) => ({ ...s, [n]: e.currentTarget.checked }))}
                          />
                        )}
                      </td>
                      <td className="py-2 pr-2 whitespace-nowrap font-medium">{p.reference ?? "??"}</td>
                      <td className="py-2 pr-2">
                        {p.title}
                        {p.existing && (
                          <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">already on this job</span>
                        )}
                        {n === null && (
                          <span className="ml-2 text-xs text-red-700 dark:text-red-300">no variation number</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{p.lineCount}</td>
                      <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                        {formatCents(p.clientTotalCents)}
                      </td>
                      <td className="py-2 pr-2">
                        {n !== null && !p.existing && approved[n] ? (
                          <input
                            type="date"
                            className="input !py-1 text-xs"
                            value={dates[n] ?? ""}
                            onChange={(e) => setDates((s) => ({ ...s, [n]: e.currentTarget.value }))}
                          />
                        ) : (
                          <span className="text-xs text-stone-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>
              Approved budget will rise by{" "}
              <strong className="tabular-nums">{formatCents(approvedTotal)}</strong>
            </span>
            {draftTotal > 0 && (
              <span className="text-stone-500">
                plus <span className="tabular-nums">{formatCents(draftTotal)}</span> held as drafts (not shown to
                the client)
              </span>
            )}
          </div>

          <button type="button" className="btn-primary" disabled={pending || importable.length === 0} onClick={commit}>
            {pending ? "Importing…" : `Import ${importable.length} variation${importable.length === 1 ? "" : "s"}`}
          </button>
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

      {(result?.warnings?.length ?? 0) > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          {result!.warnings!.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
