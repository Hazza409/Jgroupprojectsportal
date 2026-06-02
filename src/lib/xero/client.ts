// ─────────────────────────────────────────────────────────────
// Xero OAuth2 client — INTERFACE ONLY. No network calls implemented.
//
// Wiring checklist (when ready to integrate):
//   1. Register an app at https://developer.xero.com → get client id/secret.
//   2. Implement the authorize → callback flow, persisting tokens to the
//      XeroConnection model (see prisma/schema.prisma). Encrypt at rest.
//   3. Implement refresh using the stored refreshToken before expiry.
//
// Scopes needed (read-only sync): offline_access accounting.transactions.read
//   accounting.settings.read.  Add accounting.transactions ONLY if/when the
//   invoice-push step (see invoicePush.ts) is intentionally enabled.
// ─────────────────────────────────────────────────────────────

export interface XeroTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tenantId: string;
}

export function getAuthorizeUrl(_state: string): string {
  // TODO: build https://login.xero.com/identity/connect/authorize?... URL.
  throw new Error("Xero OAuth not configured. See src/lib/xero/client.ts.");
}

export async function exchangeCodeForTokens(_code: string): Promise<XeroTokens> {
  // TODO: POST https://identity.xero.com/connect/token (authorization_code grant).
  throw new Error("Xero token exchange not implemented (TODO).");
}

export async function refreshTokens(_refreshToken: string): Promise<XeroTokens> {
  // TODO: POST .../connect/token (refresh_token grant), persist new tokens.
  throw new Error("Xero token refresh not implemented (TODO).");
}
