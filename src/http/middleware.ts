/**
 * HTTP transport middleware: Origin validation and MCP-Protocol-Version checks.
 *
 * Origin validation is an MCP spec MUST for Streamable HTTP — it prevents
 * DNS-rebinding attacks where a malicious website drives a user's local server.
 */

import type { NextFunction, Request, Response } from "express";
import { ALLOWED_ORIGINS, PROTOCOL_VERSION } from "../config.js";

/** Reject requests whose Origin is not on the allowlist. Requests without an
 *  Origin header (e.g. server-to-server, curl) are allowed through — Origin is
 *  a browser-set header, and its absence isn't the rebinding threat model. */
export function originGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin === undefined) {
    next();
    return;
  }
  // Compare parsed origins (scheme+host+port) for EXACT equality. Never use
  // startsWith: a prefix match lets `http://localhost.evil.com` pass an
  // `http://localhost` allowlist entry, defeating the rebinding guard and
  // (via the reflected CORS header below) handing a hostile site access.
  const reject = (): void => {
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: `Origin not allowed: ${origin}` },
      id: null,
    });
  };
  let originValue: string;
  try {
    originValue = new URL(origin).origin;
  } catch {
    // Unparseable Origin header — reject rather than risk a loose match.
    reject();
    return;
  }
  const allowedOrigins = new Set(
    ALLOWED_ORIGINS.flatMap((a) => {
      try {
        return [new URL(a).origin];
      } catch {
        return [];
      }
    }),
  );
  if (!allowedOrigins.has(originValue)) {
    reject();
    return;
  }
  // Echo back a tightly-scoped CORS allowance (never wildcard with credentials).
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  next();
}

/** Validate the MCP-Protocol-Version header when present; 400 on unsupported. */
export function protocolVersionGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const v = req.headers["mcp-protocol-version"];
  // Absent -> spec says assume 2025-03-26; we accept and proceed.
  if (v === undefined) {
    next();
    return;
  }
  const supported = new Set([PROTOCOL_VERSION, "2025-03-26"]);
  const value = Array.isArray(v) ? v[0] : v;
  if (!supported.has(value)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: `Unsupported MCP-Protocol-Version: ${value}` },
      id: null,
    });
    return;
  }
  next();
}
