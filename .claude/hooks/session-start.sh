#!/bin/bash
set -euo pipefail

# Only needed on Claude Code on the web (remote, ephemeral containers).
# On a local machine, run `npm install && npm run build` once yourself.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PJE_DIR="$CLAUDE_PROJECT_DIR/integrations/pje-tjes-mcp"

if [ -f "$PJE_DIR/package.json" ]; then
  cd "$PJE_DIR"
  npm install --no-audit --no-fund
  npm run build
fi
