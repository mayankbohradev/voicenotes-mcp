/**
 * Streamable HTTP transport (remote / Claude.ai connector mode).
 *
 * Implements the MCP 2025-06-18 Streamable HTTP spec:
 *   - SINGLE endpoint /mcp handling POST (messages), GET (server->client SSE),
 *     and DELETE (session teardown).
 *   - Stateful sessions keyed by Mcp-Session-Id, assigned at initialize.
 *   - Origin validation + protocol-version checks (see middleware.ts).
 *   - RFC 9728 discovery endpoints (see metadata.ts).
 *
 * Token model (v1 bridge): tools call api.voicenotes.com using the upstream
 * Voicenotes OAuth token obtained via getValidAccessToken(). The first request
 * triggers the browser OAuth flow once; the cached token serves all sessions.
 */

import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "../server.js";
import { getRestToken, restOnUnauthorized } from "../auth/token-source.js";
import { HTTP_PORT, PUBLIC_URL } from "../config.js";
import { registerMetadataRoutes, wwwAuthenticate } from "./metadata.js";
import { originGuard, protocolVersionGuard } from "./middleware.js";

/** Per-session transport registry. */
const transports = new Map<string, StreamableHTTPServerTransport>();

export async function runHttpServer(port: number): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Discovery endpoints are PUBLIC (no auth) — clients read them to learn how
  // to authenticate. They must come before any auth gate.
  registerMetadataRoutes(app);

  // Health check.
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // CORS preflight for the MCP endpoint.
  app.options("/mcp", originGuard, (_req, res) => res.sendStatus(204));

  app.use("/mcp", originGuard, protocolVersionGuard);

  // ---- POST /mcp : client -> server messages ---------------------------
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New session: create a transport that assigns a session id on init.
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          },
        });

        transport.onclose = () => {
          if (transport!.sessionId) transports.delete(transport!.sessionId);
        };

        // Each session gets its own McpServer instance wired to the bridge token.
        const server = buildServer({
          getToken: getRestToken,
          onUnauthorized: restOnUnauthorized,
        });
        await server.connect(transport);
      } else {
        // Missing/unknown session id and not an initialize request.
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "Bad Request: no valid Mcp-Session-Id, and body is not an initialize request.",
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: `Internal error: ${(err as Error).message}` },
          id: null,
        });
      }
    }
  });

  // ---- GET /mcp : server -> client SSE stream --------------------------
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res
        .status(401)
        .setHeader("WWW-Authenticate", wwwAuthenticate())
        .json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Missing or unknown session." },
          id: null,
        });
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
  });

  // ---- DELETE /mcp : explicit session teardown -------------------------
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Unknown session." },
        id: null,
      });
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
  });

  // Bind to loopback by default (DNS-rebinding safety). Override host only when
  // deploying behind a trusted reverse proxy / TLS terminator.
  const host = process.env.MCP_BIND_HOST ?? "127.0.0.1";
  app.listen(port, host, () => {
    process.stderr.write(
      `[voicenotes-mcp] Streamable HTTP server listening on http://${host}:${port}/mcp\n` +
        `[voicenotes-mcp] Public URL (resource id): ${PUBLIC_URL}/mcp\n` +
        `[voicenotes-mcp] PRM: ${PUBLIC_URL}/.well-known/oauth-protected-resource\n`,
    );
  });
}

/** Convenience launcher used by index.ts. */
export function startHttp(): Promise<void> {
  return runHttpServer(HTTP_PORT ?? 3001);
}
