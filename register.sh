#!/bin/bash
# One-shot: verify your Voicenotes Sanctum PAT, then (re)register the MCP server
# globally with it. The token is read from a HIDDEN prompt and never printed,
# never written anywhere except the Claude Code user config (~/.claude.json).
#
# Usage:  bash register.sh
#
# Get your token first: voicenotes.com (logged in) -> DevTools (Cmd+Opt+I)
#   -> Application -> Local Storage -> https://voicenotes.com -> key `auth_token`
#   -> copy the value INSIDE the quotes, e.g.  12345|AbCdEf...

set -euo pipefail

DIST="/Users/mayank.bohra/Documents/Projects/voicenotes-mcp/dist/index.js"
NAME="voicenotes-custom"

if [ ! -f "$DIST" ]; then
  echo "Build first:  npm run build"; exit 1
fi

# 1) Read the token without echoing it.
read -rs -p "Paste Voicenotes auth_token (hidden): " VN
echo
if [ -z "${VN:-}" ]; then echo "No token entered. Aborting."; exit 1; fi

# 2) Verify it against the REST API BEFORE registering.
echo "Verifying token against api.voicenotes.com ..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $VN" -H "Accept: application/json" \
  "https://api.voicenotes.com/api/recordings?limit=1")

if [ "$STATUS" != "200" ]; then
  echo "FAILED: REST API returned HTTP $STATUS (expected 200)."
  echo "The token is wrong or expired. Re-copy auth_token from localStorage and retry."
  unset VN
  exit 1
fi
echo "OK: token accepted by the REST API (200)."

# 3) Remove any existing entry, then register fresh with the token as env var.
claude mcp remove "$NAME" -s user >/dev/null 2>&1 || true
claude mcp add "$NAME" --scope user --env VN_API_TOKEN="$VN" -- node "$DIST"

# 4) Don't leave the token in the shell.
unset VN

echo
echo "Done. Registered '$NAME' globally with your REST token."
echo "Health check:"
claude mcp get "$NAME" 2>&1 | sed -n '1,8p'
echo
echo "Now restart your Claude Code session, then try: \"Run vn_setup_tags as a dry run.\""
