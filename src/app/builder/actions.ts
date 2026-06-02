"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { assertBuilder } from "@/lib/scope";
import { db } from "@/lib/db";
import { dollarsToCents } from "@/lib/money";

export interface CreateJobResult {
  ok: boolean;
  message: string;
  projectId?: string;
}

// Builder-only: create a new job (project) and optionally provision the client's
// login + scoped membership in one step. The creating builder is also added as a
// member so the job's people are recorded explicitly.
export async function createJob(formData: FormData): Promise<CreateJobResult> {
  const builder = await assertBuilder();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Job name is required." };

  const address = String(formData.get("address") ?? "").trim() || null;
  const clientName = String(formData.get("clientName") ?? "").trim() || null;
  const contractValueCents = dollarsToCents(String(formData.get("contractValue") ?? "0"));

  // Optional client provisioning.
  const clientEmailRaw = String(formData.get("clientEmail") ?? "").trim().toLowerCase();
  const clientPassword = String(formData.get("clientPassword") ?? "");
  if (clientEmailRaw) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmailRaw)) {
      return { ok: false, message: "Client email looks invalid." };
    }
    if (clientPassword.length < 8) {
      return { ok: false, message: "Client temporary password must be at least 8 characters." };
    }
  }

  try {
    const projectId = await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name,
          address,
          clientName,
          contractValueCents,
          memberships: { create: [{ userId: builder.id, role: Role.BUILDER }] },
        },
      });

      if (clientEmailRaw) {
        // Reuse an existing user with this email, else create one. Never downgrade
        // an existing builder to client; just attach the membership.
        const existing = await tx.user.findUnique({ where: { email: clientEmailRaw } });
        const clientUser =
          existing ??
          (await tx.user.create({
            data: {
              email: clientEmailRaw,
              name: clientName || clientEmailRaw,
              role: Role.CLIENT,
              passwordHash: await bcrypt.hash(clientPassword, 10),
            },
          }));

        await tx.projectMembership.upsert({
          where: { userId_projectId: { userId: clientUser.id, projectId: project.id } },
          create: { userId: clientUser.id, projectId: project.id, role: Role.CLIENT },
          update: {},
        });
      }

      return project.id;
    });

    revalidatePath("/builder");
    return { ok: true, message: "Job created.", projectId };
  } catch (e) {
    // Most likely a unique-email collision race; surface a friendly message.
    return { ok: false, message: e instanceof Error ? e.message : "Could not create job." };
  }
}
