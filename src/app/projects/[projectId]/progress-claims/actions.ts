"use server";

import { revalidatePath } from "next/cache";
import { ClaimStatus, Role } from "@prisma/client";
import { assertProjectAccess, AccessError } from "@/lib/scope";
import { db } from "@/lib/db";

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/progress-claims`);
}

// Builder creates a draft claim (auto-incrementing claim number per project).
export async function createClaim(projectId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders create claims");

  const last = await db.progressClaim.findFirst({
    where: { projectId },
    orderBy: { claimNumber: "desc" },
    select: { claimNumber: true },
  });

  await db.progressClaim.create({
    data: {
      projectId,
      claimNumber: (last?.claimNumber ?? 0) + 1,
      status: ClaimStatus.DRAFT,
    },
  });
  refresh(projectId);
}

// Builder submits a draft for client approval.
export async function submitClaim(projectId: string, claimId: string) {
  const user = await assertProjectAccess(projectId);
  if (user.role !== Role.BUILDER) throw new AccessError("Only builders submit claims");

  await db.progressClaim.update({
    where: { id: claimId, projectId, status: ClaimStatus.DRAFT },
    data: { status: ClaimStatus.SUBMITTED, submittedById: user.id, submittedAt: new Date() },
  });
  refresh(projectId);
}

// Client approves or rejects a submitted claim.
export async function decideClaim(projectId: string, claimId: string, approve: boolean) {
  await assertProjectAccess(projectId); // any project member may decide; builders too
  await db.progressClaim.update({
    where: { id: claimId, projectId, status: ClaimStatus.SUBMITTED },
    data: approve
      ? { status: ClaimStatus.APPROVED, approvedAt: new Date() }
      : { status: ClaimStatus.REJECTED },
  });
  // NOTE: approving does NOT push to Xero. Invoice push is a separate, guarded,
  // human-triggered step — see src/lib/xero/invoicePush.ts.
  refresh(projectId);
}
