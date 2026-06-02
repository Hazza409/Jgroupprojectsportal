// The J Group Projects symbol — a thin angular corner mark (the brand's blind
// deboss). Inherits color via `currentColor`, so set text color on the wrapper.
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
      aria-hidden="true"
    >
      {/* vertical stem dropping to a left-turning foot — a minimalist J */}
      <path d="M30 2 V38 H8" strokeLinecap="square" />
    </svg>
  );
}
