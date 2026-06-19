#!/bin/bash
set -euo pipefail

echo "==> Setting up Voicenotes MCP..."
cd "$(dirname "$0")"

echo "==> Installing dependencies..."
npm install

echo "==> Building..."
npm run build

DIST="$(pwd)/dist/index.js"

echo ""
echo "==> Done. Build output: $DIST"
echo ""
echo "Add to Claude Code (~/.claude/mcp_settings.json) or Claude Desktop config:"
echo ""
echo '  "mcpServers": {'
echo '    "voicenotes": {'
echo '      "command": "node",'
echo "      \"args\": [\"$DIST\"]"
echo '    }'
echo '  }'
echo ""
echo "On first tool call, a browser opens for Voicenotes OAuth sign-in."
echo "For the Claude.ai web connector instead, run:  MCP_HTTP_PORT=3001 node $DIST"
