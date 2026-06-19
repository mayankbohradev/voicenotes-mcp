/**
 * McpServer factory. Builds a fully-wired server with all tools registered.
 * Transport-agnostic — index.ts attaches it to stdio or Streamable HTTP.
 *
 * Auth model: every tool resolves its token through `getToken`. In stdio mode
 * that's the OAuth browser flow (getValidAccessToken). In HTTP mode the bridge
 * supplies the per-request upstream token. Either way the tools are identical.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SERVER_INFO } from "./config.js";
import { VoicenotesApiClient } from "./api/client.js";
import {
  vnListNotes,
  vnGetNote,
  vnSearchNotes,
  vnUpdateNote,
  vnBulkTagNotes,
  vnDeleteNote,
} from "./tools/notes.js";
import {
  vnListTags,
  vnCreateTag,
  vnUpdateTag,
  vnDeleteTag,
  vnSetupTags,
} from "./tools/tags.js";
import { ok, fail } from "./tools/shared.js";

export interface BuildServerOptions {
  /** Resolves a valid Voicenotes Bearer access token for the current caller. */
  getToken: () => Promise<string>;
  /** Optional 401-recovery hook (refresh / re-auth). */
  onUnauthorized?: () => Promise<string | null>;
}

export function buildServer(opts: BuildServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO);
  const client = new VoicenotesApiClient({
    getToken: opts.getToken,
    onUnauthorized: opts.onUnauthorized,
  });

  // ===== Group A — official MCP parity ===================================

  server.registerTool(
    "vn_list_notes",
    {
      description:
        "List Voicenotes notes, newest first. Filter by tag and/or ISO date range. Use page for Laravel pagination, or fetch_all:true to retrieve EVERY note in one call.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(20).describe("Max notes per page (1-50)"),
        page: z.number().int().min(1).optional().describe("Page number (Laravel pagination)"),
        cursor: z.number().int().optional().describe("Deprecated alias for page"),
        fetch_all: z.boolean().default(false).describe("Walk all pages and return every note"),
        tag: z.string().optional().describe("Filter to a single tag name"),
        date_from: z.string().optional().describe("ISO 8601 start (inclusive)"),
        date_to: z.string().optional().describe("ISO 8601 end (inclusive)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => vnListNotes(client, args),
  );

  server.registerTool(
    "vn_get_note",
    {
      description: "Get one note by id, including its full transcript and tags.",
      inputSchema: { id: z.string().describe("Note id / UUID") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => vnGetNote(client, args),
  );

  server.registerTool(
    "vn_search_notes",
    {
      description: "Search notes by natural-language query across transcripts and titles.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(50).optional().describe("Cap on results"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => vnSearchNotes(client, args),
  );

  server.registerTool(
    "vn_create_note",
    {
      description:
        "Create a new text note with optional tags. The transcript becomes the note body.",
      inputSchema: {
        transcript: z.string().min(1).describe("Note body text"),
        tags: z.array(z.string()).optional().describe("Tag names to attach"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      // POST endpoint for note creation was unconfirmed in reverse-engineering.
      // We attempt the conventional REST shape; on failure the error result
      // tells the user to use the official Voicenotes MCP create path.
      try {
        const created = await client.post<{ id?: unknown; data?: { id?: unknown } }>(
          "/api/recordings",
          { transcript: args.transcript, tags: args.tags ?? [] },
        );
        const id =
          (created as { id?: unknown }).id ??
          (created as { data?: { id?: unknown } }).data?.id ??
          null;
        return ok({ id, created: true });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ===== Group B — extended tools =======================================

  server.registerTool(
    "vn_update_note",
    {
      description:
        "Update a note's title, tags, and/or transcript. tags REPLACES the full list; omitting tags PRESERVES existing ones (e.g. when editing only the title/transcript).",
      inputSchema: {
        id: z.string().describe("Note id"),
        title: z.string().optional().describe("New title"),
        tags: z.array(z.string()).optional().describe("Full replacement tag list (omit to keep existing)"),
        transcript: z.string().optional().describe("Corrected transcript text"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    (args) => vnUpdateNote(client, args),
  );

  server.registerTool(
    "vn_bulk_tag_notes",
    {
      description:
        "Add tags to multiple notes at once. ADDS to existing tags (does not replace).",
      inputSchema: {
        note_ids: z.array(z.string()).min(1).describe("Note ids to tag"),
        tags_to_add: z.array(z.string()).min(1).describe("Tag names to add to each"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (args) => vnBulkTagNotes(client, args),
  );

  server.registerTool(
    "vn_list_tags",
    {
      description: "List all tags: id, name, keywords, pin state, and usage count.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => vnListTags(client),
  );

  server.registerTool(
    "vn_create_tag",
    {
      description: "Create a tag with optional auto-tagging keywords, pin state, emoji.",
      inputSchema: {
        name: z.string().describe("Tag name"),
        keywords: z.array(z.string()).default([]).describe("Auto-tag keywords"),
        is_pinned: z.boolean().default(false).describe("Pin to top"),
        emoji: z.string().optional().describe("Optional emoji"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (args) => vnCreateTag(client, args),
  );

  server.registerTool(
    "vn_update_tag",
    {
      description: "Update a tag's name, keywords, and/or pin state.",
      inputSchema: {
        id: z.number().int().describe("Tag id"),
        name: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        is_pinned: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    (args) => vnUpdateTag(client, args),
  );

  server.registerTool(
    "vn_delete_tag",
    {
      description: "Delete a tag permanently.",
      inputSchema: { id: z.number().int().describe("Tag id") },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    (args) => vnDeleteTag(client, args),
  );

  server.registerTool(
    "vn_setup_tags",
    {
      description:
        "One-shot: create the 10 personal-OS tags with keywords. Skips existing. Use dry_run to preview.",
      inputSchema: {
        dry_run: z.boolean().default(false).describe("Preview without creating"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (args) => vnSetupTags(client, args),
  );

  // ===== Group C — future stubs =========================================

  server.registerTool(
    "vn_delete_note",
    {
      description:
        "[Group C / unconfirmed endpoint] Delete a note. Requires confirm:true to attempt.",
      inputSchema: {
        id: z.string().describe("Note id"),
        confirm: z.boolean().default(false).describe("Must be true to actually delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    (args) => vnDeleteNote(client, args),
  );

  server.registerTool(
    "vn_get_user_profile",
    {
      description: "[Group C — not yet implemented] Get the authenticated user's profile.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => ok({ not_implemented: true, reason: "User profile endpoint not yet confirmed." }),
  );

  server.registerTool(
    "vn_list_webhooks",
    {
      description: "[Group C — not yet implemented] List configured webhooks.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => ok({ not_implemented: true, reason: "Webhooks endpoint not yet confirmed." }),
  );

  return server;
}
