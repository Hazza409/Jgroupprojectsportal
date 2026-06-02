// ─────────────────────────────────────────────────────────────
// Xero OAuth2 (authorization code flow) — real implementation.
//
// Setup:
//   1. Create an app at https://developer.xero.com.
//   2. Add the redirect URI (XERO_REDIRECT_URI) to the app config.
//   3. Set XERO_CLIENT_ID / XERO_CLIENT_SECRET / XERO_REDIRECT_URI in .env.
//
// Scopes: read-only sync only. accounting.transactions write is intentionally
// NOT requested — the invoice-push step (invoicePush.ts) stays disabled.
// ─────────────────────────────────────────────────────────────

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";

export const XERO_SCOPES = [
  "offline_access",
  "accounting.transactions.read",
  "accounting.settings.read",
].join(" ");

export interface XeroTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tenantId: string;
}

function requireConfig() {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  const redirectUri = process.env.XERO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Xero not configured. Set XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI.");
  }
  return { clientId, clientSecret, redirectUri };
}

function basicAuth(): string {
  const { clientId, clientSecret } = requireConfig();
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

/** Build the consent URL the builder is redirected to. `state` ties the callback to a project. */
export function getAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = requireConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: XERO_SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Fetch the tenant (org) id for the freshly-issued access token. Uses the first connection. */
async function fetchTenantId(accessToken: string): Promise<string> {
  const res = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Xero connections lookup failed: ${res.status}`);
  const conns = (await res.json()) as Array<{ tenantId: string }>;
  if (!conns.length) throw new Error("No Xero organisations authorised for this connection.");
  return conns[0].tenantId;
}

async function parseTokenResponse(res: Response): Promise<Omit<XeroTokens, "tenantId">> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Xero token request failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
  };
}

/** Exchange an authorization code for tokens + resolve the tenant id. */
export async function exchangeCodeForTokens(code: string): Promise<XeroTokens> {
  const { redirectUri } = requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  const tokens = await parseTokenResponse(res);
  const tenantId = await fetchTenantId(tokens.accessToken);
  return { ...tokens, tenantId };
}

/** Refresh an expiring access token. Tenant id is preserved by the caller. */
export async function refreshTokens(refreshToken: string): Promise<Omit<XeroTokens, "tenantId">> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  return parseTokenResponse(res);
}
