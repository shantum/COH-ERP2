#!/usr/bin/env bash
# PostToolUse (async): Run TypeCheck in background after file edits
# Delivers results on next conversation turn without blocking
# Uses --incremental for 5-6x faster cached runs (18s → 3s client, 10s → 6s server)
set -euo pipefail

INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Extract file path to decide which project to check
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$FILE_PATH" ] && exit 0

# Make path relative
REL_PATH="${FILE_PATH#$PROJECT_DIR/}"

# Only check TypeScript files
case "$REL_PATH" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# Skip non-source files (node_modules, dist, etc.)
case "$REL_PATH" in
  node_modules/*|dist/*|.next/*|build/*) exit 0 ;;
esac

# --- Concurrency guard: kill any previous tsc processes for this project ---
# Kill by pattern matching, then wait for them to actually die before proceeding.
STALE_PIDS=$(pgrep -f "COH-ERP2.*tsc.*--noEmit" 2>/dev/null || true)
if [ -n "$STALE_PIDS" ]; then
  echo "$STALE_PIDS" | xargs kill 2>/dev/null || true
  # Wait up to 3s for processes to die
  for i in 1 2 3; do
    pgrep -f "COH-ERP2.*tsc.*--noEmit" >/dev/null 2>&1 || break
    sleep 1
  done
  # Force kill any survivors
  pkill -9 -f "COH-ERP2.*tsc.*--noEmit" 2>/dev/null || true
fi

# Incremental build info stored in /tmp (survives session, cleared on reboot)
CLIENT_BUILDINFO="/tmp/coh-client-tsbuildinfo"
SERVER_BUILDINFO="/tmp/coh-server-tsbuildinfo"

# Run tsc ONCE, save full output to temp file
TSC_OUTPUT=$(mktemp)
trap "rm -f '$TSC_OUTPUT'" EXIT

if [[ "$REL_PATH" == client/* ]]; then
  cd "$PROJECT_DIR/client" 2>/dev/null || exit 0
  npx tsc -p tsconfig.app.json --noEmit --incremental --tsBuildInfoFile "$CLIENT_BUILDINFO" 2>&1 > "$TSC_OUTPUT" || true
  PROJECT="client"
elif [[ "$REL_PATH" == server/* ]]; then
  cd "$PROJECT_DIR/server" 2>/dev/null || exit 0
  npx tsc --noEmit --incremental --tsBuildInfoFile "$SERVER_BUILDINFO" 2>&1 > "$TSC_OUTPUT" || true
  PROJECT="server"
elif [[ "$REL_PATH" == shared/* ]]; then
  cd "$PROJECT_DIR/client" 2>/dev/null || exit 0
  npx tsc -p tsconfig.app.json --noEmit --incremental --tsBuildInfoFile "$CLIENT_BUILDINFO" 2>&1 > "$TSC_OUTPUT" || true
  PROJECT="shared (via client)"
else
  exit 0
fi

# Count and extract from the SAME output (no second tsc run)
ERRORS=$(grep -c "error TS" "$TSC_OUTPUT" || true)

if [ "$ERRORS" -gt 0 ] 2>/dev/null; then
  DETAILS=$(grep "error TS" "$TSC_OUTPUT" | head -5)
  jq -n --arg project "$PROJECT" --arg count "$ERRORS" --arg details "$DETAILS" '{
    "hookSpecificOutput": {
      "hookEventName": "PostToolUse",
      "additionalContext": ("TypeCheck (" + $project + "): " + $count + " error(s) found after your last edit.\n" + $details + "\nFix these before committing.")
    }
  }'
fi

exit 0
