// The J Group Projects symbol — a slim "J": a vertical stroke down the right,
// a generously rounded corner, then a long foot to the left. Square aspect,
// flat stroke ends, matched to the brand lock-up. Inherits color via
// `currentColor` (set text color on the wrapper), so it follows the theme.
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth={8}
      strokeLinecap="butt"
      className={className}
      aria-hidden="true"
    >
      <path d="M80 6 V71 A17 17 0 0 1 63 88 H6" />
    </svg>
  );
}
