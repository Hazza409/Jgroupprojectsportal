/**
 * Scratch harness: parse a folder of J Group variation PDFs and report what
 * came out, cross-checked against the printed totals. Not part of the app.
 *
 *   npx tsx scripts/try-variation-pdfs.ts "<folder>"
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseVariationPdfBuffer } from "../src/lib/pdf/parseVariationPdf";
import { formatCents } from "../src/lib/money";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/try-variation-pdfs.ts <folder>");
  process.exit(1);
}

async function main() {
  const files = readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort();
  console.log(
    ["REF".padEnd(9), "DATE".padEnd(12), "LN".padStart(3), "BASE".padStart(14), "+MARGIN".padStart(14), "PRINTED".padStart(14), "INC GST".padStart(14)].join(" "),
  );
  console.log("-".repeat(88));

  let base = 0;
  let gross = 0;
  const problems: string[] = [];
  for (const f of files) {
    const p = await parseVariationPdfBuffer(readFileSync(join(dir, f)), f, 12.5);
    const regrossed = Math.round(p.totalCents * 1.125);
    const ok = p.printedSubtotalCents !== null && Math.abs(regrossed - p.printedSubtotalCents) <= 100;
    base += p.totalCents;
    gross += p.printedTotalCents ?? 0;
    console.log(
      [
        (p.reference ?? "??").padEnd(9),
        (p.date ? p.date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "2-digit" }) : "--").padEnd(12),
        String(p.lines.length).padStart(3),
        formatCents(p.totalCents).padStart(14),
        formatCents(regrossed).padStart(14),
        (p.printedSubtotalCents === null ? "--" : formatCents(p.printedSubtotalCents)).padStart(14),
        (p.printedTotalCents === null ? "--" : formatCents(p.printedTotalCents)).padStart(14),
      ].join(" ") + (ok ? "" : "   <-- MISMATCH"),
    );
    console.log(`          ${p.title.slice(0, 74)}`);
    for (const w of p.warnings) problems.push(w);
  }
  console.log("-".repeat(88));
  console.log(`${files.length} variations`);
  console.log(`  base (ex margin, ex GST)  ${formatCents(base).padStart(16)}`);
  console.log(`  printed total (inc GST)   ${formatCents(gross).padStart(16)}`);
  console.log(`  base grossed 12.5% + 10%  ${formatCents(Math.round(base * 1.125 * 1.1)).padStart(16)}`);
  if (problems.length) {
    console.log(`\nwarnings (${problems.length}):`);
    for (const w of problems) console.log(`  ! ${w}`);
  } else {
    console.log(`\nno warnings — every document reconciles to its printed subtotal.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
