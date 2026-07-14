"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";

// A thumbnail that opens full-size in an overlay when clicked. Keeps the
// existing thumbnail styling (via `className`) so callers can drop it in where
// an <img> was. Closes on backdrop click or Escape.
export function LightboxImage({
  src,
  alt,
  caption,
  className,
}: {
  src: string;
  alt: string;
  caption?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    // Prevent the page behind the overlay from scrolling.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full cursor-zoom-in"
        aria-label={`View ${alt} full size`}
      >
        <img src={src} alt={alt} className={className} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-lg leading-none text-white hover:bg-white/20"
          >
            ✕
          </button>
          {/* stopPropagation so clicking the image itself doesn't close it */}
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
          />
          {caption && <p className="mt-3 max-w-2xl text-center text-sm text-white/80">{caption}</p>}
        </div>
      )}
    </>
  );
}
