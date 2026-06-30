"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { assertBuilder } from "@/lib/scope";
import { db } from "@/lib/db";
import { validatePassword } from "@/lib/password";

export interface StaffResult {
  ok: boolean;
  message: string;
}

// Builder-only: create a project-manager login (a BUILDER user). PMs see all
// projects and receive the team notification emails (meeting requests, variation
// approvals). They set their own password after first sign-in (TODO: reset flow).
export async function createStaff(formData: FormData): Promise<StaffResult> {
  await assertBuilder();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").trim();

  if (!name) return { ok: false, message: "Name is required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Enter a valid email." };
  const pwCheck = validatePassword(password);
  if (!pwCheck.ok) return { ok: false, message: pwCheck.message! };

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { ok: false, message: "A user with that email already exists." };

  await db.user.create({
    data: { name, email, role: Role.BUILDER, passwordHash: await bcrypt.hash(password, 10) },
  });

  revalidatePath("/builder/team");
  return { ok: true, message: `Project manager login created for ${email}.` };
}
