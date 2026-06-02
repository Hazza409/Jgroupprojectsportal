import { db } from "../db";
import { encrypt, decrypt } from "./crypto";
import { refreshTokens, type XeroTokens } from "./client";

// Persistence + lifecycle for a project's Xero connection. Tokens are encrypted
// at rest (see crypto.ts). Callers get a guaranteed-valid access token via
// getValidAccessToken(), which refreshes transparently when near expiry.

export async function saveConnection(projectId: string, tokens: XeroTokens) {
  await db.xeroConnection.upsert({
    where: { projectId },
    create: {
      projectId,
      xeroTenantId: tokens.tenantId,
      accessToken: encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
    },
    update: {
      xeroTenantId: tokens.tenantId,
      accessToken: encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
      connectedAt: new Date(),
    },
  });
}

export interface ActiveConnection {
  accessToken: string;
  tenantId: string;
}

/** Returns a valid access token for the project, refreshing if it expires soon. Null if not connected. */
export async function getValidAccessToken(projectId: string): Promise<ActiveConnection | null> {
  const conn = await db.xeroConnection.findUnique({ where: { projectId } });
  if (!conn?.accessToken || !conn.refreshToken || !conn.xeroTenantId) return null;

  const expiresSoon = !conn.expiresAt || conn.expiresAt.getTime() - Date.now() < 60_000;
  if (!expiresSoon) {
    return { accessToken: decrypt(conn.accessToken), tenantId: conn.xeroTenantId };
  }

  // Refresh. Xero rotates the refresh token on every use — persist the new pair.
  const refreshed = await refreshTokens(decrypt(conn.refreshToken));
  await db.xeroConnection.update({
    where: { projectId },
    data: {
      accessToken: encrypt(refreshed.accessToken),
      refreshToken: encrypt(refreshed.refreshToken),
      expiresAt: refreshed.expiresAt,
    },
  });
  return { accessToken: refreshed.accessToken, tenantId: conn.xeroTenantId };
}

export async function isConnected(projectId: string): Promise<boolean> {
  const conn = await db.xeroConnection.findUnique({
    where: { projectId },
    select: { accessToken: true },
  });
  return !!conn?.accessToken;
}
