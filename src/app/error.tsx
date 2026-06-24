"use client";

import { useEffect } from "react";
import Link from "next/link";

// App-level error boundary. Without this, any client-side render error unmounts
// the React tree and leaves a blank white page with no message. This catches it
// and shows a recoverable UI (and logs the error to the browser console).
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error boundary:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-stone-500">
        This page hit an unexpected error. Try again, or head back to your projects.
      </p>
      {(error?.message || error?.digest) && (
        <p className="mt-3 max-w-md break-words rounded-md bg-stone-100 px-3 py-2 text-xs text-stone-500">
          {error.message || `Reference: ${error.digest}`}
        </p>
      )}
      <div className="mt-5 flex gap-3">
        <button onClick={() => reset()} className="btn-primary">Try again</button>
        <Link href="/projects" className="btn-ghost">My projects</Link>
      </div>
    </div>
  );
}
