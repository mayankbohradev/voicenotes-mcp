#!/usr/bin/env node
/**
 * Entry point. Detects transport from the environment:
 *   - MCP_HTTP_PORT set  -> Streamable HTTP (Claude.ai web connector)
 *   - otherwise          -> stdio (Claude Code / Claude Desktop)
 *
 * Both transports share the same tool set and the same OAuth machinery.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { resetAuth } from "./auth/oauth.js";
import { getRestToken, restOnUnauthorized, hasApiToken, PAT_HELP } from "./auth/token-source.js";
import { HTTP_PORT } from "./config.js";
import { startHttp } from "./http/server.js";

async function runStdio(): Promise<void> {
  // CRITICAL for stdio: never write non-protocol output to stdout. All logging
  // goes to stderr (the SDK and our code follow this).
  const server = buildServer({
    getToken: getRestToken,
    onUnauthorized: restOnUnauthorized,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (!hasApiToken()) {
    process.stderr.write(`[voicenotes-mcp] WARNING: VN_API_TOKEN not set. ${PAT_HELP}\n`);
  }
  process.stderr.write("[voicenotes-mcp] stdio server ready.\n");
}

async function main(): Promise<void> {
  // Tiny CLI escape hatch: `voicenotes-mcp --logout` wipes stored auth.
  if (process.argv.includes("--logout")) {
    await resetAuth();
    process.stderr.write("[voicenotes-mcp] Cleared stored token and client.\n");
    return;
  }

  if (HTTP_PORT) {
    await startHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  process.stderr.write(`[voicenotes-mcp] Fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
