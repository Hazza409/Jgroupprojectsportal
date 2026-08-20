// ─────────────────────────────────────────────────────────────
// HOUSE STYLE for client-facing writing (Jake §6).
//
// "Whoever writes it is writing under the J Group name." Site shorthand is
// fine internally; it is not fine in front of a client. This normalises the
// fortnightly summary on save: full trade names, proper sentence case.
//
// Deliberately conservative — it fixes known shorthand and capitalisation
// only. It never rewrites the author's sentences.
// ─────────────────────────────────────────────────────────────

/** Site shorthand → the full trade name a client should read. */
const TRADE_TERMS: [RegExp, string][] = [
  [/\bbrickies\b/gi, "bricklayers"],
  [/\bbrickie\b/gi, "bricklayer"],
  [/\b(?:chippies|chippys)\b/gi, "carpenters"],
  [/\b(?:chippie|chippy)\b/gi, "carpenter"],
  [/\b(?:sparkies|sparkys)\b/gi, "electricians"],
  [/\b(?:sparky|sparkie)\b/gi, "electrician"],
  [/\bplumbies\b/gi, "plumbers"],
  [/\bgyprockers\b/gi, "plasterers"],
  [/\bgyprocker\b/gi, "plasterer"],
  [/\brenderers?\b/gi, "renderers"],
  [/\bscaffies\b/gi, "scaffolders"],
  [/\bconcreters?\b/gi, "concreters"],
  [/\btruckies?\b/gi, "truck drivers"],
  [/\bexcy\b/gi, "excavator operator"],
  [/\breo\b/gi, "steel reinforcement"],
  [/\bdemo\b/gi, "demolition"],
  [/\baircon\b/gi, "air conditioning"],
  [/\bwaterproofers?\b/gi, "waterproofers"],
  [/\blino\b/gi, "vinyl flooring"],
  // General informality that shouldn't reach a client.
  [/\barvo\b/gi, "afternoon"],
  [/\bsmoko\b/gi, "break"],
  [/\bthe boys\b/gi, "the team"],
  [/\bthe guys\b/gi, "the team"],
];

/** Capitalise the first letter of each line and each sentence. */
function sentenceCase(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trimEnd();
      if (!trimmed.trim()) return trimmed;
      // Capitalise after a line start, or after . ! ? followed by a space.
      // Leading list markers ("- ", "• ", "1. ") are preserved.
      return trimmed.replace(
        /(^\s*(?:[-•*]\s*|\d+[.)]\s*)?|[.!?]\s+)([a-z])/g,
        (_m, lead: string, ch: string) => lead + ch.toUpperCase(),
      );
    })
    .join("\n");
}

export interface HouseStyleResult {
  text: string;
  /** Shorthand terms that were expanded, for showing the author. */
  changed: string[];
}

/**
 * Apply house style to one field of client-facing copy.
 * Returns the cleaned text plus which shorthand terms were expanded.
 */
export function applyHouseStyle(input: string | null | undefined): HouseStyleResult {
  if (!input) return { text: "", changed: [] };
  let text = input;
  const changed: string[] = [];

  for (const [pattern, replacement] of TRADE_TERMS) {
    const hits = text.match(pattern);
    if (hits && hits.length) {
      // Only report a real change (e.g. "concreters" → "concreters" is a no-op).
      if (hits.some((h) => h.toLowerCase() !== replacement.toLowerCase())) {
        changed.push(`${hits[0]} → ${replacement}`);
      }
      text = text.replace(pattern, replacement);
    }
  }

  // Collapse runs of blank lines and trailing spaces, then fix capitalisation.
  text = text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  text = sentenceCase(text).trim();

  return { text, changed };
}

/** Convenience: apply house style to a nullable field, keeping null as null. */
export function houseStyleField(input: string | null): { value: string | null; changed: string[] } {
  const v = (input ?? "").trim();
  if (!v) return { value: null, changed: [] };
  const r = applyHouseStyle(v);
  return { value: r.text || null, changed: r.changed };
}

// ─────────────────────────────────────────────────────────────
// Cost-item spelling (Jake, Budget Revisions §7).
//
// These names arrive from the imported estimate workbook, so the misspellings
// live in the source data, not in our code. Correcting them at DISPLAY time
// means the client-facing views read correctly straight away and STAY correct
// when the estimate is re-imported — a one-off database edit would be undone
// by the next import.
//
// Display only. Cost-code matching still works off the stored name, so nothing
// re-links or moves money as a result of this.
// ─────────────────────────────────────────────────────────────
const COST_NAME_FIXES: [RegExp, string][] = [
  [/\bScaff?hold\b/gi, "Scaffold"],
  [/\bAccomodation\b/gi, "Accommodation"],
  // "Rubbish (builders Waste)" → "Rubbish (Builders' Waste)": the possessive
  // apostrophe and the capital are both wrong in the source sheet.
  [/\bbuilders\s+waste\b/gi, "Builders' Waste"],
];

/** Fix known misspellings in a cost-item name for client-facing display. */
export function correctCostName(name: string): string {
  let out = name;
  for (const [re, fix] of COST_NAME_FIXES) out = out.replace(re, fix);
  return out;
}
