"use client";

// Last-resort boundary for errors thrown in the ROOT layout itself (which the
// regular error.tsx can't catch). Must render its own <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          minHeight: "100vh",
          margin: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "2rem",
          background: "#0c0a09",
          color: "#fafaf9",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ color: "#a8a29e", marginTop: 8 }}>The app hit an unexpected error.</p>
        {error?.digest && (
          <p style={{ color: "#78716c", fontSize: 12, marginTop: 4 }}>Reference: {error.digest}</p>
        )}
        <button
          onClick={() => reset()}
          style={{
            marginTop: 20,
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: "#fafaf9",
            color: "#0c0a09",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
