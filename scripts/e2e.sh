#!/usr/bin/env bash
# Runs the plugin's e2e specs against a Mirador test host, with Mirador's own Playwright, so the specs share it with
# Mirador's e2e helpers. MIRADOR_DIR names Mirador's checkout; by default it sits next to this one.
# Usage: scripts/e2e.sh [Playwright arguments]
set -euo pipefail

plugin=$(cd "$(dirname "$0")/.." && pwd)
mirador=$(cd "${MIRADOR_DIR:-$plugin/../visualized-claude-sessions}" && pwd)
ln -sfn "$mirador/node_modules" "$plugin/e2e/node_modules"
(cd "$plugin" && bun run build)
cd "$mirador"
MIRADOR_DIR="$mirador" exec bunx playwright test -c "$plugin/e2e/playwright.config.ts" "$@"
