"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
