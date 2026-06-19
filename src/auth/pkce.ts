/**
 * PKCE (RFC 7636) and CSRF state generation.
 *
 * Voicenotes' AS metadata advertises code_challenge_methods_supported: ["S256"],
 * so we ONLY ever produce S256 challenges — never "plain". This is also an MCP
 * spec MUST: clients MUST implement PKCE per OAuth 2.1 §7.5.2.
 */

import { createHash, randomBytes } from "node:crypto";

export interface PkcePair {
  /** High-entropy secret kept by the client; sent on the token exchange. */
  verifier: string;
  /** SHA-256(verifier), base64url — sent on the authorization request. */
  challenge: string;
  method: "S256";
}

/** base64url encode (no padding, URL-safe) per RFC 7636 Appendix A. */
function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Generate a PKCE verifier/challenge pair.
 * Verifier: 32 random bytes -> 43-char base64url string (within the
 * RFC-mandated 43–128 char range).
 */
export function generatePkce(): PkcePair {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}

/** Cryptographically random anti-CSRF state value, validated on callback. */
export function generateState(): string {
  return base64url(randomBytes(24));
}
