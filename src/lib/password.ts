// Shared password policy, enforced on every set-password path. Length-first
// (NIST 800-63B style): a longer minimum protects better than fiddly complexity
// rules. Applied when a password is SET — existing logins are unaffected.
export const MIN_PASSWORD_LENGTH = 12;

export function validatePassword(raw: string): { ok: boolean; message?: string } {
  const pw = (raw ?? "").trim();
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (/^\d+$/.test(pw)) {
    return { ok: false, message: "Password can't be only numbers — mix in letters." };
  }
  return { ok: true };
}
