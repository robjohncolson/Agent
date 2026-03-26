#!/usr/bin/env bash

# Claude launches Git Bash without /usr/bin on PATH in this Windows setup.
PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

set -u

AGENT_DIR="${AGENT_REPO:-C:/Users/rober/Downloads/Projects/Agent}"
SESSION_FILE="$AGENT_DIR/state/session.json"
OBS_FILE="$AGENT_DIR/observations/log.json"

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
highest_obs_id=""

if [ -f "$OBS_FILE" ]; then
  highest_obs_id="$(
    jq -r '
      if type == "array" and length > 0 then
        (map((.id // 0) | tonumber? // 0) | max)
      else
        ""
      end
    ' "$OBS_FILE" 2>/dev/null
  )"
fi

synced_json="null"
synced_label="N/A"
if [[ "$highest_obs_id" =~ ^[0-9]+$ ]]; then
  synced_json="$highest_obs_id"
  synced_label="$highest_obs_id"
fi

session_base="{}"
if [ -f "$SESSION_FILE" ] && jq -e . "$SESSION_FILE" >/dev/null 2>&1; then
  session_base="$(cat "$SESSION_FILE")"
fi

session_dir="$(dirname "$SESSION_FILE")"
mkdir -p "$session_dir" >/dev/null 2>&1

tmp_file="$(mktemp "$session_dir/.session.json.tmp.XXXXXX" 2>/dev/null || printf '%s/.session.json.tmp.%s' "$session_dir" "$$")"

if printf '%s' "$session_base" | jq --arg ts "$timestamp" --arg trigger "auto-precompact" --argjson synced "$synced_json" '
  (if type == "object" then . else {} end)
  | .last_checkpoint_at = $ts
  | .checkpoint_trigger = $trigger
  | .last_synced_observation_id = $synced
' > "$tmp_file" 2>/dev/null; then
  mv "$tmp_file" "$SESSION_FILE" 2>/dev/null || rm -f "$tmp_file"
else
  rm -f "$tmp_file"
fi

echo "Context checkpoint saved at ${timestamp}. Synced through observation #${synced_label}."
exit 0
