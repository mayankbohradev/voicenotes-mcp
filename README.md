# Voicenotes MCP

A custom [Model Context Protocol](https://modelcontextprotocol.io) server for [Voicenotes](https://voicenotes.com). It lets an MCP client (Claude Code, Claude Desktop, or the Claude.ai web connector) search, read, create, edit, tag, and organize your Voicenotes notes through natural language.

Built on a reverse-engineered Voicenotes REST API. It speaks both transports:

- **stdio** — for Claude Code / Claude Desktop (browser-based OAuth on first call)
- **Streamable HTTP** — for the Claude.ai web connector

---

## Quick start

```bash
git clone <this-repo> voicenotes-mcp
cd voicenotes-mcp
npm install
npm run build          # compiles src/ -> dist/
```

Then register it with your client. Two supported paths:

### A. Personal access token (fastest — Claude Code)

```bash
bash register.sh
```

It prompts (hidden input) for your Voicenotes `auth_token`, verifies it against the API, then registers the server globally with the token passed as the `VN_API_TOKEN` env var. Get the token from a logged-in `voicenotes.com` tab: **DevTools → Application → Local Storage → `auth_token`** (copy the value inside the quotes).

### B. OAuth (Claude Desktop / stdio)

Add to your client config and let it run over stdio — a browser opens for Voicenotes sign-in on the first tool call:

```json
{
  "mcpServers": {
    "voicenotes": { "command": "node", "args": ["/abs/path/to/dist/index.js"] }
  }
}
```

For the **Claude.ai web connector**, run the HTTP transport instead:

```bash
MCP_HTTP_PORT=3001 node dist/index.js
```

All config is via environment variables; every one is optional with sane defaults. See [`.env.example`](./.env.example).

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `VN_API_TOKEN` | — | Voicenotes bearer token. When set, the REST path is used directly (path A). Never commit it. |
| `MCP_HTTP_PORT` | unset | Set to run the Streamable HTTP server (Claude.ai web). Unset = stdio. |
| `MCP_PUBLIC_URL` | `http://localhost:<port>` | Public URL the HTTP server is reachable at (OAuth resource id). |
| `MCP_BIND_HOST` | `127.0.0.1` | Host the HTTP server binds to. |
| `MCP_ALLOWED_ORIGINS` | Claude surfaces + localhost | Comma-separated Origin allowlist for the HTTP transport. |
| `VN_CALLBACK_PORT` | `9876` | Local loopback port for the OAuth callback (stdio flow). |

Tokens obtained via OAuth are stored **encrypted** (AES-256-GCM, `0600`) under `~/.voicenotes-mcp/` — never inside the repo.

---

## Tools

14 tools, grouped by maturity:

- **Group A** — parity with the official Voicenotes MCP.
- **Group B** — extended tools this server adds (bulk tagging, tag management, setup).
- **Group C** — stubs for endpoints not yet confirmed; gated or no-op until verified.

### Notes

| Tool | Group | What it does |
|------|-------|--------------|
| `vn_list_notes` | A | List notes, newest first. Filter by tag / ISO date range; paginate or `fetch_all`. |
| `vn_get_note` | A | Get one note by id, with full transcript and tags. |
| `vn_search_notes` | A | Natural-language search across transcripts and titles. |
| `vn_create_note` | A | Create a text note (transcript = body) with optional tags. |
| `vn_update_note` | B | Update title / tags / transcript. Omitting `tags` preserves existing ones. |
| `vn_bulk_tag_notes` | B | Add tags to many notes at once (adds, never replaces). |
| `vn_delete_note` | C | Delete a note. Unconfirmed endpoint — requires `confirm:true` to attempt. |

### Tags

| Tool | Group | What it does |
|------|-------|--------------|
| `vn_list_tags` | A | List all tags: id, name, keywords, pin state, usage count. |
| `vn_create_tag` | B | Create a tag with optional auto-tag keywords, pin state, emoji. |
| `vn_update_tag` | B | Update a tag's name, keywords, and/or pin state. |
| `vn_delete_tag` | B | Delete a tag permanently. |
| `vn_setup_tags` | B | One-shot: create a starter set of organizing tags. Idempotent; supports `dry_run`. |

### Account (stubs)

| Tool | Group | What it does |
|------|-------|--------------|
| `vn_get_user_profile` | C | Get the authenticated user's profile. *Not yet implemented.* |
| `vn_list_webhooks` | C | List configured webhooks. *Not yet implemented.* |

---

## Sample prompts

Phrase requests naturally — the client picks the tool. Examples per tool:

**`vn_list_notes`**
> "Show me my 10 most recent notes."
> "List every note tagged `work` from May 2026."

**`vn_get_note`**
> "Open the note with id `abc-123` and show the full transcript."

**`vn_search_notes`**
> "Search my notes for anything about the pricing decision."
> "Find notes that mention the onboarding flow."

**`vn_create_note`**
> "Create a note: 'Follow up with the design team about the new dashboard.' Tag it `todo` and `work`."

**`vn_update_note`**
> "Fix the title of note `abc-123` to 'Q3 Planning'."
> "Append the cleaned-up transcript to note `abc-123` but keep its existing tags."

**`vn_bulk_tag_notes`**
> "Add the tag `archive` to notes `id1`, `id2`, and `id3`."

**`vn_delete_note`**
> "Delete note `abc-123`." *(re-confirm with `confirm:true` when asked)*

**`vn_list_tags`**
> "What tags do I have, and how many notes use each?"

**`vn_create_tag`**
> "Create a pinned tag called `urgent` with keywords 'asap, blocker, deadline'."

**`vn_update_tag`**
> "Rename tag 12 to `personal` and unpin it."

**`vn_delete_tag`**
> "Delete tag 12."

**`vn_setup_tags`**
> "Run vn_setup_tags as a dry run to preview the starter tags."
> "Set up my organizing tags."

---

## Development

```bash
npm run build                            # tsc -> dist/
node dist/index.js                       # stdio transport
MCP_HTTP_PORT=3001 node dist/index.js    # HTTP transport
```

Source layout:

```
src/
  api/        REST client + endpoint wrappers (recordings, tags) + types
  auth/       OAuth (PKCE, DCR), callback server, encrypted token store
  http/       Streamable HTTP transport, middleware, OAuth metadata
  tools/      Tool handlers (notes, tags) + shared helpers
  server.ts   Tool registry (names, schemas, descriptions)
  index.ts    Entry point / transport selection
```

---

## Notes & caveats

- Unofficial: built on a reverse-engineered API, so endpoints may change.
- Group C tools target endpoints not yet confirmed and are stubbed or guarded.
- `vn_update_note` / `vn_update_tag` are destructive on the fields you pass — `tags` **replaces** the full list unless omitted.

## License

MIT — add a `LICENSE` file before publishing if you want others to reuse it.
