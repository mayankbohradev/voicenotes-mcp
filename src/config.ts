/**
 * Central configuration and constants.
 *
 * IMPORTANT: The OAuth endpoints below were VERIFIED LIVE against Voicenotes'
 * published OAuth 2.0 metadata on 2026-06-07, NOT guessed:
 *
 *   GET https://api.voicenotes.com/.well-known/oauth-protected-resource
 *     -> { resource: "https://api.voicenotes.com",
 *          authorization_servers: ["https://api.voicenotes.com"],
 *          scopes_supported: ["mcp:use"] }
 *
 *   GET https://api.voicenotes.com/.well-known/oauth-authorization-server
 *     -> { authorization_endpoint: ".../oauth/authorize",
 *          token_endpoint:         ".../oauth/token",
 *          registration_endpoint:  ".../oauth/register",
 *          code_challenge_methods_supported: ["S256"],
 *          grant_types_supported: ["authorization_code","refresh_token"] }
 *
 * This corrects the PRD, which guessed the auth host as `voicenotes.com` and
 * the scope as `read write`. The real auth server lives at `api.voicenotes.com`
 * and the only scope is `mcp:use`.
 */

/** Base URL for the Voicenotes REST API (data plane). */
export const API_BASE_URL = "https://api.voicenotes.com";

/**
 * Voicenotes OAuth 2.1 authorization server. Per the live metadata, the AS is
 * co-located with the resource server at api.voicenotes.com.
 */
export const OAUTH = {
  /** RFC 8414 authorization server metadata document. */
  metadataUrl: `${API_BASE_URL}/.well-known/oauth-authorization-server`,
  authorizationEndpoint: `${API_BASE_URL}/oauth/authorize`,
  tokenEndpoint: `${API_BASE_URL}/oauth/token`,
  /** RFC 7591 Dynamic Client Registration endpoint. */
  registrationEndpoint: `${API_BASE_URL}/oauth/register`,
  /** The only scope Voicenotes advertises for MCP access. */
  scope: "mcp:use",
} as const;

/**
 * Sanctum Personal Access Token for the REST API (data plane).
 *
 * IMPORTANT (discovered 2026-06-07 via live probes): the OAuth `mcp:use` token
 * is ONLY valid for the POST /mcp endpoint. The REST API (/api/recordings,
 * /api/tags, ...) uses a SEPARATE Laravel Sanctum auth domain and returns 401
 * "User is Unauthenticated" for OAuth tokens. So all REST-backed tools must
 * authenticate with the website's `auth_token` (format: `{user_id}|{random}`),
 * pulled from localStorage on voicenotes.com.
 *
 * Provide it via the VN_API_TOKEN env var (never commit it). When set, the REST
 * client uses it directly; OAuth remains available for the /mcp surface.
 */
export const VN_API_TOKEN = process.env.VN_API_TOKEN?.trim() || null;

/**
 * Loopback callback used by the stdio OAuth flow. The spec (and Voicenotes'
 * exact-match redirect validation) requires this be registered verbatim via DCR.
 * Loopback HTTP is explicitly permitted by OAuth 2.1 for native/public clients.
 */
export const CALLBACK_PORT = Number(process.env.VN_CALLBACK_PORT ?? 9876);
export const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

/** Identity advertised to Voicenotes during Dynamic Client Registration. */
export const CLIENT_NAME = "Voicenotes Custom MCP";

/** MCP server identity (reported in the initialize handshake). */
export const SERVER_INFO = {
  name: "voicenotes-mcp",
  version: "1.0.0",
} as const;

/**
 * Streamable HTTP transport settings (remote / Claude.ai connector mode).
 * Set MCP_HTTP_PORT to enable HTTP mode; otherwise the server runs over stdio.
 */
export const HTTP_PORT = process.env.MCP_HTTP_PORT
  ? Number(process.env.MCP_HTTP_PORT)
  : null;

/** Public URL this HTTP server is reachable at (the OAuth "resource" identifier). */
export const PUBLIC_URL =
  process.env.MCP_PUBLIC_URL ?? `http://localhost:${HTTP_PORT ?? 3001}`;

/**
 * Origins allowed to call the HTTP transport. The spec REQUIRES Origin
 * validation on every Streamable HTTP request to prevent DNS-rebinding attacks.
 * Comma-separated list via MCP_ALLOWED_ORIGINS; defaults to Claude surfaces + local.
 */
export const ALLOWED_ORIGINS = (
  process.env.MCP_ALLOWED_ORIGINS ??
  "https://claude.ai,https://www.claude.ai,http://localhost,http://127.0.0.1"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/** MCP protocol version we negotiate / fall back to. */
export const PROTOCOL_VERSION = "2025-06-18";
