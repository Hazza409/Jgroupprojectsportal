/**
 * Generates the example spreadsheets the parsers expect, into ./examples.
 * Run with: npm run make:samples
 * These double as documentation of the accepted column format.
 */
import * as XLSX from "xlsx";
import path from "path";
import { promises as fs } from "fs";

async function main() {
  const dir = path.resolve("examples");
  await fs.mkdir(dir, { recursive: true });

  // ── Estimate ──────────────────────────────────────────────
  const estimate = [
    ["Cost Code", "Description", "Qty", "Unit", "Unit Cost", "Total"],
    ["1.00", "Preliminaries & site establishment", 1, "item", 28500, 28500],
    ["2.10", "Excavation & earthworks", 1, "item", 41200, 41200],
    ["3.10", "Concrete footings & slab", 220, "m2", 185, 40700],
    ["4.10", "Framing & structural timber", 1, "item", 96500, 96500],
    ["5.20", "Roofing — standing seam", 310, "m2", 240, 74400],
    ["6.10", "Windows & external doors (architectural)", 1, "item", 132000, 132000],
    ["7.30", "Carpentry — joinery & fit-out", 1, "item", 178000, 178000],
    ["8.10", "Electrical", 1, "item", 64500, 64500],
    ["8.20", "Plumbing & drainage", 1, "item", 71000, 71000],
    ["9.40", "Stone benchtops & tiling", 1, "item", 58000, 58000],
  ];
  const wbE = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbE, XLSX.utils.aoa_to_sheet(estimate), "Estimate");
  XLSX.writeFile(wbE, path.join(dir, "sample-estimate.xlsx"));

  // ── Schedule ──────────────────────────────────────────────
  const schedule = [
    ["Task", "Start", "Finish", "% Complete"],
    ["Site establishment", "2026-02-02", "2026-02-13", 100],
    ["Earthworks & excavation", "2026-02-16", "2026-03-06", 100],
    ["Footings & slab", "2026-03-09", "2026-03-27", 80],
    ["Frame", "2026-03-30", "2026-05-01", 40],
    ["Roof", "2026-05-04", "2026-05-22", 0],
    ["Lock-up (windows/doors)", "2026-05-25", "2026-06-19", 0],
    ["Fit-out & joinery", "2026-06-22", "2026-08-28", 0],
    ["Services rough-in", "2026-05-25", "2026-06-26", 0],
    ["Finishes & handover", "2026-08-31", "2026-10-09", 0],
  ];
  const wbS = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(schedule), "Schedule");
  XLSX.writeFile(wbS, path.join(dir, "sample-schedule.xlsx"));

  console.log("Wrote examples/sample-estimate.xlsx and examples/sample-schedule.xlsx");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
