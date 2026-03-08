#!/usr/bin/env bash
set -euo pipefail

PROMPT_FILE="${1:?prompt file is required}"
WORKING_DIR="${2:?working directory is required}"
ALLOWED_TOOLS="${3:-Edit,Read,Write,Bash,Glob,Grep}"
CLAUDE_BIN="${4:-${CLAUDE_BIN:-claude}}"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Prompt file not found: $PROMPT_FILE" >&2
  exit 1
fi

cd "$WORKING_DIR" || exit 1
PROMPT_CONTENT="$(cat "$PROMPT_FILE")"

unset CLAUDECODE || true

"$CLAUDE_BIN" -p "$PROMPT_CONTENT" \
  --allowedTools "$ALLOWED_TOOLS" \
  --output-format text \
  2>&1
