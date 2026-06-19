/**
 * OAuth discovery metadata endpoints (RFC 9728 / RFC 8414).
 *
 * Per MCP 2025-06-18, the MCP server (Resource Server) MUST expose Protected
 * Resource Metadata pointing at its authorization server(s). We point directly
 * at Voicenotes' real AS (api.voicenotes.com), which we verified live. This
 * lets a fully spec-compliant MCP client run the OAuth flow itself, while our
 * stdio/bridge path uses the same endpoints internally.
 */

import type { Express, Request, Response } from "express";
import { API_BASE_URL, OAUTH, PUBLIC_URL } from "../config.js";

/** The canonical resource identifier for THIS MCP server (no trailing slash). */
export function resourceIdentifier(): string {
  return `${PUBLIC_URL.replace(/\/$/, "")}/mcp`;
}

export function registerMetadataRoutes(app: Express): void {
  // RFC 9728 — Protected Resource Metadata. Clients fetch this after a 401.
  const prm = (_req: Request, res: Response) => {
    res.json({
      resource: resourceIdentifier(),
      // Voicenotes' verified authorization server.
      authorization_servers: [API_BASE_URL],
      scopes_supported: [OAUTH.scope],
      bearer_methods_supported: ["header"],
    });
  };
  app.get("/.well-known/oauth-protected-resource", prm);
  // Also serve the path-suffixed variant some clients probe.
  app.get("/.well-known/oauth-protected-resource/mcp", prm);

  // RFC 8414 — convenience mirror of the upstream AS metadata, so clients that
  // look for it under our origin still discover the real endpoints.
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: API_BASE_URL,
      authorization_endpoint: OAUTH.authorizationEndpoint,
      token_endpoint: OAUTH.tokenEndpoint,
      registration_endpoint: OAUTH.registrationEndpoint,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [OAUTH.scope],
    });
  });
}

/** Build the WWW-Authenticate header value for a 401 (RFC 9728 §5.1). */
export function wwwAuthenticate(): string {
  const metadataUrl = `${PUBLIC_URL.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
  return `Bearer realm="voicenotes-mcp", resource_metadata="${metadataUrl}"`;
}
