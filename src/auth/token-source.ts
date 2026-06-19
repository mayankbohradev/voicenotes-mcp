/**
 * Resolves which credential the REST API client should use.
 *
 * Background: live probing on 2026-06-07 proved the REST API (/api/*) does NOT
 * accept the OAuth `mcp:use` token — it uses a separate Laravel Sanctum auth
 * domain. So for REST-backed tools we authenticate with the website's Personal
 * Access Token (`auth_token` from localStorage), supplied via VN_API_TOKEN.
 *
 * Priority:
 *   1. VN_API_TOKEN (Sanctum PAT) — the only credential /api/* accepts.
 *   2. OAuth access token — kept as a fallback / for the /mcp surface, but it
 *      will 401 against /api/*; we surface a clear, actionable error if no PAT
 *      is configured so the user knows exactly what to do.
 */

import { VN_API_TOKEN } from "../config.js";
import { getValidAccessToken, onUnauthorized as oauthOnUnauthorized } from "./oauth.js";

/** True when a Sanctum PAT is configured (REST calls can succeed). */
export function hasApiToken(): boolean {
  return VN_API_TOKEN !== null;
}

/**
 * Returns the token the REST client should send. Prefers the Sanctum PAT.
 * If neither a PAT nor OAuth is available, throws a guidance error.
 */
export async function getRestToken(): Promise<string> {
  if (VN_API_TOKEN) return VN_API_TOKEN;
  // No PAT configured: fall back to OAuth so the error path is reached with a
  // real (but wrong-audience) token, producing the API's own 401. Better UX is
  // the explicit guard below, so callers should check hasApiToken() first.
  return getValidAccessToken();
}

/**
 * 401 recovery for the REST client. With a static PAT there is nothing to
 * refresh — a 401 means the PAT is wrong/expired, so we return null (no retry)
 * and let the client surface an actionable error. When falling back to OAuth,
 * delegate to the OAuth refresh policy.
 */
export async function restOnUnauthorized(): Promise<string | null> {
  if (VN_API_TOKEN) return null; // static token; can't auto-recover
  return oauthOnUnauthorized();
}

/** Human-readable instructions shown when REST auth is missing/failing. */
export const PAT_HELP =
  "REST tools need your Voicenotes website token. Get it from voicenotes.com → " +
  "DevTools → Application → Local Storage → key `auth_token` (the value inside " +
  "the quotes, like `12345|AbCd...`), then set VN_API_TOKEN in the MCP server env.";
