#!/usr/bin/env bash

set -u

AGENT_DIR="${CLAUDE_PROJECT_DIR:-C:/Users/rober/Downloads/Projects/Agent}"
STAGE_SCRIPT="$AGENT_DIR/scripts/stage-dispatch.ps1"

payload="$(cat)"
if [ -z "${payload//[[:space:]]/}" ]; then
  exit 0
fi

if ! printf '%s' "$payload" | jq -e . >/dev/null 2>&1; then
  exit 0
fi

parsed_text="$(
  printf '%s' "$payload" | jq -r '
    def as_text:
      if . == null then ""
      elif type == "string" then .
      elif type == "number" or type == "boolean" then tostring
      elif type == "array" then map(
        as_text
      ) | join("\n")
      elif type == "object" then
        [
          .text?,
          .content?,
          .message?,
          .body?
        ] | map(as_text) | join("\n")
      else ""
      end;

    [
      (.last_assistant_message | as_text),
      (.assistant_message | as_text),
      (.transcript | as_text),
      (.context | as_text),
      (
        if (.messages // null | type) == "array" then
          (.messages | map(as_text) | join("\n"))
        else
          ""
        end
      )
    ] | join("\n")
  ' 2>/dev/null
)"

if [ -z "$parsed_text" ]; then
  parsed_text="$payload"
fi

text_to_scan="$(printf '%s\n%s' "$parsed_text" "$payload" | tr '[:upper:]' '[:lower:]')"
should_stage=0

if printf '%s' "$text_to_scan" | grep -Eq 'dispatch/prompts/[a-z0-9._/-]+'; then
  should_stage=1
elif printf '%s' "$text_to_scan" | grep -Eq 'staging/[a-z0-9._/-]+'; then
  should_stage=1
elif printf '%s' "$text_to_scan" | grep -Eq '(specialist prompt|review prompt)' \
  && printf '%s' "$text_to_scan" | grep -Eq '\bdispatch\b'; then
  should_stage=1
fi

if [ "$should_stage" -eq 1 ] && [ -f "$STAGE_SCRIPT" ]; then
  if powershell -ExecutionPolicy Bypass -File "$STAGE_SCRIPT" >/dev/null 2>&1; then
    echo "Auto-staged files for dispatch" >&2
  else
    echo "Auto-stage attempt failed" >&2
  fi
fi

exit 0
