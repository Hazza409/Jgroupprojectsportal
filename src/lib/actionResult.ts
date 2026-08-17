"use client";

// ─────────────────────────────────────────────────────────────
// Calling a Server Action safely from a form.
//
// Every form in this app does the same thing: await a Server Action, then
// read `.message` off the result. That is fine until the call doesn't come
// back the way the types promise, and then it is very much not fine — the
// read throws, React unmounts the whole route into the error boundary, and
// the user loses everything they had typed. On the schedule that is a full
// fortnightly progress update entered by hand.
//
// Two things go wrong in production that never go wrong locally:
//
//   1. The action resolves to `undefined`. Next.js can't find the action on
//      the server, which happens when a deploy lands while someone has the
//      page open — their tab holds the OLD bundle and posts an action id the
//      NEW server build doesn't have. Nothing threw; the result is simply
//      absent, so `res.message` is a read off undefined. This is the crash
//      Harry hit right after a Render deploy.
//   2. The promise rejects — the server threw, the database was briefly
//      unreachable, the session expired mid-edit, the laptop lost wifi.
//
// Neither is worth destroying a page over. Both mean "not saved, tell them
// plainly, keep their work on screen so they can retry".
// ─────────────────────────────────────────────────────────────

export interface ActionOutcome {
  ok: boolean;
  message: string;
}

/** A deploy landed under the user's feet; their bundle is stale. */
const STALE_BUILD =
  "The app was updated while this page was open, so nothing was saved. Reload the page and try again — your edits are still here until you do.";

const UNREACHABLE =
  "Couldn't reach the server, so nothing was saved. Check your connection and try again.";

/**
 * Run a Server Action and always come back with something readable.
 *
 * Returns the action's own result when it behaves. Otherwise returns a
 * plain failure the caller can render — never throws, so the caller's
 * `res.message` is always safe and the page stays up.
 */
export async function runAction<T extends ActionOutcome>(
  call: () => Promise<T>,
): Promise<T | ActionOutcome> {
  try {
    const res = await call();
    // The types say this can't be null. Production says otherwise.
    if (res == null || typeof res.message !== "string") {
      return { ok: false, message: STALE_BUILD };
    }
    return res;
  } catch (err) {
    // Don't surface raw server text to a client — it leaks internals and
    // reads like a stack trace. Log it for us, show plain English to them.
    console.error("Server action failed:", err);
    return { ok: false, message: UNREACHABLE };
  }
}
