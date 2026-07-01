// The J Group Projects symbol — a bold "J": a thick vertical stroke curving into
// a foot at the bottom-left. Inherits color via `currentColor`, so set the text
// color on the wrapper. Scales crisply at any size.
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={7}
      strokeLinecap="butt"
      className={className}
      aria-hidden="true"
    >
      {/* stem down the right, a rounded corner, then a foot to the left */}
      <path d="M30 4 V33 A7 7 0 0 1 23 40 H4" />
    </svg>
  );
}
