"use server";

import bcrypt from "bcryptjs";
import { getSessionUser } from "@/auth";
import { db } from "@/lib/db";

export interface ChangePasswordResult {
  ok: boolean;
  message: string;
}

const MIN_LENGTH = 10;

// Change the CURRENT user's own password. Requires the existing password (so a
// hijacked open session can't silently lock the real owner out), enforces a
// minimum length, and clears any brute-force lockout on success. Passwords are
// trimmed to match how login compares them.
export async function changePassword(formData: FormData): Promise<ChangePasswordResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Your session has expired — please sign in again." };

  const current = String(formData.get("currentPassword") ?? "").trim();
  const next = String(formData.get("newPassword") ?? "").trim();
  const confirm = String(formData.get("confirmPassword") ?? "").trim();

  if (!current || !next || !confirm) return { ok: false, message: "Please fill in all three fields." };
  if (next.length < MIN_LENGTH) return { ok: false, message: `New password must be at least ${MIN_LENGTH} characters.` };
  if (next !== confirm) return { ok: false, message: "The new passwords don't match." };
  if (next === current) return { ok: false, message: "New password must be different from the current one." };

  const record = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!record) return { ok: false, message: "Account not found." };

  const currentOk = await bcrypt.compare(current, record.passwordHash);
  if (!currentOk) return { ok: false, message: "Current password is incorrect." };

  const passwordHash = await bcrypt.hash(next, 10);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
  });

  return { ok: true, message: "Password updated. Use your new password next time you sign in." };
}
