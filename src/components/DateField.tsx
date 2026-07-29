"use client";

import { useState } from "react";

// ─────────────────────────────────────────────────────────────
// ONE date convention, everywhere (Jake §6).
//
// Native <input type="date"> renders in the BROWSER's locale, so on a US
// machine it shows 07/27/2026 no matter what we do — which is exactly the
// inconsistency Jake flagged. This field is locale-proof: it always reads and
// writes day-first DD/MM/YYYY, echoes the parsed date back in full ("27 July
// 2026") so there's no ambiguity, and posts a machine ISO value to the server
// via a hidden input.
// ─────────────────────────────────────────────────────────────

/** "2026-07-27" | "2026-07-27T14:30" → "27/07/2026" */
function toDayFirst(iso: string | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
function timePart(iso: string | undefined): string {
  if (!iso) return "";
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : "";
}

/** "27/07/2026" (also 27-7-2026, 27.07.26) → {y,m,d} or null. Day-first ONLY. */
function parseDayFirst(text: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})$/.exec(text.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Reject impossible days (31 Feb etc.) by round-tripping.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

const LONG = new Intl.DateTimeFormat("en-AU", { dateStyle: "long" });

export function DateField({
  name,
  defaultValue,
  required = false,
  withTime = false,
}: {
  name: string;
  /** ISO ("2026-07-27" or "2026-07-27T14:30"). */
  defaultValue?: string;
  required?: boolean;
  withTime?: boolean;
}) {
  const [text, setText] = useState(() => toDayFirst(defaultValue));
  const [time, setTime] = useState(() => timePart(defaultValue));

  const parsed = parseDayFirst(text);
  const isoDate = parsed
    ? `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`
    : "";
  // datetime-local shape when a time is wanted; plain date otherwise.
  const hiddenValue = isoDate ? (withTime ? `${isoDate}T${time || "09:00"}` : isoDate) : "";
  const invalid = text.trim().length > 0 && !parsed;

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/YYYY"
          value={text}
          required={required}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={invalid}
          className={`input ${invalid ? "border-red-500" : ""}`}
        />
        {withTime && (
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="input !w-32"
            aria-label="Time"
          />
        )}
      </div>
      {/* What the server actually receives. */}
      <input type="hidden" name={name} value={hiddenValue} />
      <p className={`mt-1 text-xs ${invalid ? "text-red-600 dark:text-red-300" : "text-stone-400"}`}>
        {invalid
          ? "Enter the date as DD/MM/YYYY — day first."
          : parsed
            ? `→ ${LONG.format(new Date(parsed.y, parsed.m - 1, parsed.d))}${withTime && time ? ` at ${time}` : ""}`
            : "Day first — e.g. 27/07/2026"}
      </p>
    </div>
  );
}
