#!/bin/bash
set -euo pipefail

# Only needed in Claude Code on the web / cloud sessions — a local dev machine
# almost certainly already has a full LibreOffice install.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# This environment's base image ships only libreoffice-core (the engine),
# not libreoffice-writer (the module that actually reads/writes .docx/.odt and
# exports PDF). Without it, `soffice --headless --convert-to pdf` fails with
# "Error: source file could not be loaded" for every file, docx or otherwise.
# Used by the bff-chargeback skill to convert generated notifications to PDF.
if ! dpkg -s libreoffice-writer >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y --no-install-recommends libreoffice-writer
fi
