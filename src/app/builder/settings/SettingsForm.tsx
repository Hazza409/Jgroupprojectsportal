"use client";

import { runAction } from "@/lib/actionResult";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCompany, uploadLogo, removeLogo, type SettingsResult } from "./actions";
import type { Company } from "@prisma/client";

/** null when the rate is unchanged (or unparseable), else {from, to}. */
type RateChange = { from: number; to: number } | null;

function rateChange(current: number, submitted: FormDataEntryValue | null): RateChange {
  const raw = String(submitted ?? "").trim();
  // Number("") is 0, not NaN — without this an empty field reads as "change the
  // rate to 0%", which would strip margin from every figure on every job. The
  // input is `required` so the browser normally blocks it, but this must not
  // depend on that.
  if (raw === "") return null;
  const next = Number(raw);
  if (!Number.isFinite(next)) return null;
  // Compare to the cent of a percent — a re-render of "12.5" must not read as a change.
  return Math.abs(next - current) < 0.001 ? null : { from: current, to: next };
}

// Company settings form. Values are pre-filled from the Company row; saving
// rebrands the whole app (header, landing, login, emails, claim documents).
export function SettingsForm({ company, logoUrl }: { company: Company; logoUrl: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SettingsResult | null>(null);

  function run(action: () => Promise<SettingsResult>) {
    setResult(null);
    startTransition(async () => {
      const res = await runAction(() => action());
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  // ── Commercial-rate guard ──────────────────────────────────
  // Margin and GST are not ordinary settings. There is ONE rate for the whole
  // company and every figure is grossed up through it on read, so changing it
  // silently restates history: budgets, cost-to-complete and variation prices
  // on EVERY job, including ones a client has already been shown at the old
  // rate. On a cost-plus contract that is exactly the kind of quiet change
  // that is hard to defend later, so it gets an explicit confirmation naming
  // the old and new rate. Everything else on this form saves as before.
  const [confirming, setConfirming] = useState<{ form: FormData; margin: RateChange; gst: RateChange } | null>(null);

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const margin = rateChange(company.marginPercent, form.get("marginPercent"));
    const gst = rateChange(company.gstPercent, form.get("gstPercent"));
    if (margin || gst) {
      setResult(null);
      setConfirming({ form, margin, gst });
      return;
    }
    run(() => updateCompany(form));
  }

  function confirmSave() {
    const form = confirming?.form;
    setConfirming(null);
    if (form) run(() => updateCompany(form));
  }

  function onLogo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    run(() => uploadLogo(form));
  }

  return (
    <div className="space-y-6">
      {/* Identity + commercial settings */}
      <form onSubmit={onSave} className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Identity</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">Company name</label>
            <input id="name" name="name" className="input" required defaultValue={company.name} />
            <p className="mt-1 text-xs text-stone-400">Shown in the header, landing page, emails and claim documents.</p>
          </div>
          <div>
            <label className="label" htmlFor="shortName">Short name</label>
            <input id="shortName" name="shortName" className="input" defaultValue={company.shortName ?? ""} placeholder="e.g. J Group" />
            <p className="mt-1 text-xs text-stone-400">Used in compact places like the home-screen icon label.</p>
          </div>
          <div>
            <label className="label" htmlFor="tagline">Tagline</label>
            <input id="tagline" name="tagline" className="input" defaultValue={company.tagline ?? ""} placeholder="e.g. One Of One" />
            <p className="mt-1 text-xs text-stone-400">Small line under the company name. Leave blank to hide.</p>
          </div>
          <div>
            <label className="label" htmlFor="location">Location</label>
            <input id="location" name="location" className="input" defaultValue={company.location ?? ""} placeholder="e.g. Sydney" />
            <p className="mt-1 text-xs text-stone-400">Shown in the landing-page footer. Leave blank to hide.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="printFooter">Claim document footer</label>
            <input id="printFooter" name="printFooter" className="input" defaultValue={company.printFooter ?? ""} placeholder="e.g. Design · Construction · Landscape" />
            <p className="mt-1 text-xs text-stone-400">Footer line on printed progress claims, after the company name.</p>
          </div>
        </div>

        <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Brand colours</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="brandColorDark">Accent — dark theme</label>
            <input id="brandColorDark" name="brandColorDark" className="input" defaultValue={company.brandColorDark ?? ""} placeholder="#FFFFFF (default)" />
          </div>
          <div>
            <label className="label" htmlFor="brandColorLight">Accent — light theme</label>
            <input id="brandColorLight" name="brandColorLight" className="input" defaultValue={company.brandColorLight ?? ""} placeholder="#1A1A1A (default)" />
          </div>
          <p className="sm:col-span-2 -mt-2 text-xs text-stone-400">
            6-digit hex codes for buttons, links and highlights. Leave blank for the standard monochrome look.
          </p>
        </div>

        <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Commercial</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="marginPercent">Builder&apos;s margin %</label>
            <input id="marginPercent" name="marginPercent" type="number" step="0.1" min="0" max="100" className="input" required defaultValue={company.marginPercent} />
            <p className="mt-1 text-xs text-stone-400">Applied to estimates, variations and cost-to-complete figures shown to clients.</p>
          </div>
          <div>
            <label className="label" htmlFor="gstPercent">GST %</label>
            <input id="gstPercent" name="gstPercent" type="number" step="0.1" min="0" max="50" className="input" required defaultValue={company.gstPercent} />
          </div>
        </div>

        <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Fortnightly sign-off</h2>
        <div>
          <label className="label" htmlFor="forecastApprovers">Approvers (emails, comma-separated)</label>
          <input
            id="forecastApprovers"
            name="forecastApprovers"
            className="input"
            placeholder="nick@jgroupprojects.com"
            defaultValue={company.forecastApprovers ?? ""}
          />
          <p className="mt-1 text-xs text-stone-400">
            Everyone listed here must sign off a project&apos;s forecast figures before they publish to the client.
            Editing the figures after a sign-off voids it and requires re-signing. Leave blank and nothing can publish.
          </p>
        </div>

        {/* Names the actual consequence rather than asking "are you sure". */}
        {confirming && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4" role="alert">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              {confirming.margin && confirming.gst
                ? "You're changing the builder's margin and GST"
                : confirming.margin
                  ? "You're changing the builder's margin"
                  : "You're changing GST"}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-amber-900/90 dark:text-amber-100/90">
              {confirming.margin && (
                <li className="tabular-nums">
                  Builder&apos;s margin {confirming.margin.from}% → <strong>{confirming.margin.to}%</strong>
                </li>
              )}
              {confirming.gst && (
                <li className="tabular-nums">
                  GST {confirming.gst.from}% → <strong>{confirming.gst.to}%</strong>
                </li>
              )}
            </ul>
            <p className="mt-3 text-sm text-amber-900/90 dark:text-amber-100/90">
              There is one rate for the whole company, and every figure is grossed up through it when the page
              is drawn. This will restate the budget, cost-to-complete and variation prices on{" "}
              <strong>every job</strong> — including figures a client has already been shown at the old rate.
            </p>
            <p className="mt-2 text-sm text-amber-900/90 dark:text-amber-100/90">
              Progress claims already issued keep the margin recorded on them, so those are unaffected.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" onClick={confirmSave} disabled={pending}>
                Change the rate
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirming(null)} disabled={pending}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </button>
          {result && (
            <span className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>{result.message}</span>
          )}
        </div>
      </form>

      {/* Logo */}
      <form onSubmit={onLogo} className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Logo</h2>
        <div className="flex flex-wrap items-center gap-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Current logo" className="h-10 w-auto rounded bg-stone-100 p-1" />
          ) : (
            <p className="text-sm text-stone-500">No logo uploaded — using the built-in mark.</p>
          )}
          <input name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="text-xs" />
          <button type="submit" className="btn-ghost" disabled={pending}>
            {pending ? "Uploading…" : "Upload logo"}
          </button>
          {logoUrl && (
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(() => removeLogo())}>
              Remove logo
            </button>
          )}
        </div>
        <p className="text-xs text-stone-400">PNG, JPG, SVG or WebP, under 2 MB. Shown in the header and on the landing page.</p>
      </form>
    </div>
  );
}
