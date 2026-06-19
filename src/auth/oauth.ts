/**
 * OAuth 2.1 + PKCE + Dynamic Client Registration orchestration for the stdio
 * flow (and as the upstream-token source for the HTTP bridge).
 *
 * Endpoints are the VERIFIED Voicenotes values from config.ts (probed live on
 * 2026-06-07), not guesses. Flow:
 *
 *   getValidAccessToken()
 *     ├─ cached token still fresh?            -> return it
 *     ├─ cached token expired but refreshable -> refresh (rotates refresh token)
 *     └─ no usable token                      -> full browser authorize flow
 *
 * Security properties enforced here:
 *   - PKCE S256 on every authorize + token call (RFC 7636)
 *   - resource indicator (RFC 8707) bound to api.voicenotes.com
 *   - cryptographic state, validated in callback.ts (anti-CSRF)
 *   - refresh-token ROTATION: we always persist the newly-returned refresh
 *     token, so the old one is discarded (OAuth 2.1 MUST for public clients)
 *   - tokens persisted only via the secure tokenStore (keychain / encrypted)
 */

import open from "open";
import { CLIENT_NAME, OAUTH, REDIRECT_URI, API_BASE_URL } from "../config.js";
import { generatePkce, generateState } from "./pkce.js";
import { waitForCallback } from "./callback.js";
import {
  tokenStore,
  type ClientRegistration,
  type TokenSet,
} from "./token-store.js";

/**
 * Refresh tokens this many ms BEFORE actual expiry, so a long-running tool call
 * never races the clock. 60s skew is a common, conservative default.
 */
const EXPIRY_SKEW_MS = 60_000;

/** In-flight auth promise, so concurrent tool calls don't open N browsers. */
let inflight: Promise<TokenSet> | null = null;

/** Convert an OAuth token endpoint response into our stored TokenSet. */
function toTokenSet(raw: Record<string, unknown>, prev?: TokenSet): TokenSet {
  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
  return {
    access_token: String(raw.access_token),
    // Rotation: prefer the new refresh token; only fall back to the prior one
    // if the AS chose not to issue a fresh one this round.
    refresh_token:
      typeof raw.refresh_token === "string"
        ? raw.refresh_token
        : prev?.refresh_token,
    token_type: typeof raw.token_type === "string" ? raw.token_type : "Bearer",
    scope: typeof raw.scope === "string" ? raw.scope : prev?.scope ?? OAUTH.scope,
    expires_at: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  };
}

function isFresh(t: TokenSet): boolean {
  if (!t.expires_at) return true; // no expiry advertised -> assume usable
  return Date.now() < t.expires_at - EXPIRY_SKEW_MS;
}

// ---- Dynamic Client Registration (RFC 7591) ------------------------------

async function getClientRegistration(): Promise<ClientRegistration> {
  const cached = await tokenStore.getClient();
  if (cached?.client_id) return cached;

  const res = await fetch(OAUTH.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client
      scope: OAUTH.scope,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Dynamic Client Registration failed (${res.status}) at ${OAUTH.registrationEndpoint}: ${body}`,
    );
  }

  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.client_id !== "string") {
    throw new Error("DCR response did not include a client_id.");
  }
  const reg: ClientRegistration = {
    client_id: json.client_id,
    client_secret:
      typeof json.client_secret === "string" ? json.client_secret : undefined,
  };
  await tokenStore.saveClient(reg);
  return reg;
}

// ---- Authorization Code + PKCE flow --------------------------------------

async function runBrowserFlow(): Promise<TokenSet> {
  const client = await getClientRegistration();
  const pkce = generatePkce();
  const state = generateState();

  const authUrl = new URL(OAUTH.authorizationEndpoint);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT_URI,
    scope: OAUTH.scope,
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method,
    // RFC 8707 resource indicator — binds the token's audience to our API.
    resource: API_BASE_URL,
  }).toString();

  // Start listening BEFORE opening the browser to avoid a redirect race.
  const callbackPromise = waitForCallback(state);
  await open(authUrl.toString());
  process.stderr.write(
    `\n[voicenotes-mcp] Opened browser for Voicenotes sign-in.\n` +
      `If it didn't open, visit:\n${authUrl.toString()}\n\n`,
  );

  const { code } = await callbackPromise;
  return exchangeCode(code, pkce.verifier, client);
}

async function exchangeCode(
  code: string,
  verifier: string,
  client: ClientRegistration,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: client.client_id,
    code_verifier: verifier,
    resource: API_BASE_URL,
  });
  if (client.client_secret) body.set("client_secret", client.client_secret);

  const res = await fetch(OAUTH.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${txt}`);
  }
  const tokens = toTokenSet((await res.json()) as Record<string, unknown>);
  await tokenStore.saveToken(tokens);
  return tokens;
}

async function refresh(prev: TokenSet): Promise<TokenSet | null> {
  if (!prev.refresh_token) return null;
  const client = await getClientRegistration();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: prev.refresh_token,
    client_id: client.client_id,
    scope: OAUTH.scope,
    resource: API_BASE_URL,
  });
  if (client.client_secret) body.set("client_secret", client.client_secret);

  const res = await fetch(OAUTH.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    // Refresh token rejected/expired — caller falls back to full re-auth.
    return null;
  }
  const tokens = toTokenSet((await res.json()) as Record<string, unknown>, prev);
  await tokenStore.saveToken(tokens); // persists the ROTATED refresh token
  return tokens;
}

// ---- Public entry points -------------------------------------------------

/**
 * Returns a valid access token, performing refresh or a full browser flow as
 * needed. Concurrent callers share a single in-flight auth.
 */
export async function getValidAccessToken(): Promise<string> {
  const cached = await tokenStore.getToken();
  if (cached && isFresh(cached)) return cached.access_token;

  if (cached?.refresh_token) {
    const refreshed = await refresh(cached);
    if (refreshed) return refreshed.access_token;
  }

  // Need interactive auth — dedupe concurrent attempts.
  if (!inflight) {
    inflight = runBrowserFlow().finally(() => {
      inflight = null;
    });
  }
  return (await inflight).access_token;
}

/**
 * onUnauthorized POLICY (wired into the API client).
 *
 * Decision (secure default): on a 401 we try a single refresh; if that fails we
 * clear the stored token and force a fresh browser flow. We do NOT silently
 * loop — getValidAccessToken's `inflight` guard ensures at most one browser
 * opens. This trades a little UX friction (occasional re-login) for the
 * guarantee that a revoked/expired token is never reused.
 *
 * Returns a fresh access token to retry the failed request with, or null.
 */
export async function onUnauthorized(): Promise<string | null> {
  const cached = await tokenStore.getToken();
  if (cached?.refresh_token) {
    const refreshed = await refresh(cached);
    if (refreshed) return refreshed.access_token;
  }
  // Refresh impossible/failed -> drop the bad token and re-authorize.
  await tokenStore.clearToken();
  try {
    return await getValidAccessToken();
  } catch {
    return null;
  }
}

/** Wipe all stored auth (token + DCR client). For a `logout`/reset path. */
export async function resetAuth(): Promise<void> {
  await tokenStore.clearToken();
  await tokenStore.clearClient();
}
