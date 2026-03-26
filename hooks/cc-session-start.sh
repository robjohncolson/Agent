#!/usr/bin/env bash

# Claude launches Git Bash without /usr/bin on PATH in this Windows setup.
PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

set -u

AGENT_DIR="${AGENT_REPO:-C:/Users/rober/Downloads/Projects/Agent}"
PROFILES_DIR="$AGENT_DIR/profiles"
SESSION_FILE="$AGENT_DIR/state/session.json"
OBS_LOG_FILE="$AGENT_DIR/observations/log.json"

trim_text() {
  local text="${1:-}"
  local max_len="${2:-120}"

  text="$(printf '%s' "$text" | tr '\r\n' ' ' | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
  if [ "${#text}" -gt "$max_len" ]; then
    printf '%s...' "${text:0:max_len-3}"
  else
    printf '%s' "$text"
  fi
}

profile_label() {
  case "$1" in
    claude-code) printf 'CC' ;;
    codex) printf 'Codex' ;;
    gemini) printf 'Gemini' ;;
    chatgpt-deep-research) printf 'GPT' ;;
    deepseek) printf 'DeepSeek' ;;
    grok) printf 'Grok' ;;
    *) printf '%s' "$1" ;;
  esac
}

extract_profile_entry() {
  local profile_file="$1"

  jq -r '
    def first_strength: (.strengths // [] | map(select(type == "object")) | .[0] // {});
    def role_raw:
      if (.routing_role // null) != null then
        if (.routing_role | type) == "string" then .routing_role
        elif (.routing_role | type) == "object" then
          if .routing_role.is_hub == true then "hub"
          elif .routing_role.is_synthesizer == true then "synthesizer"
          elif .routing_role.is_architect == true then "architect"
          else (.routing_role.notes // "routing-role")
          end
        else "routing-role"
        end
      else (first_strength.trait // "TBD")
      end;
    def role_norm:
      (role_raw
        | split(" / ")[0]
        | ascii_downcase
        | if test("system") then "systems"
          elif test("visual|ux|aesthetic") then "visual"
          elif test("math|stat") then "math"
          elif test("executor|implementation|code") then "executor"
          elif test("hub|synth|dispatch|context") then "hub"
          elif test("tbd|untested|^$") then "TBD"
          else .
          end);
    def confidence:
      ((first_strength.confidence // .confidence // 0) | tonumber? // 0);
    [(.id // "N/A"), role_norm, (confidence | tostring)] | @tsv
  ' "$profile_file" 2>/dev/null
}

print_roster() {
  local -a profile_files=()
  local profile_file parsed profile_id role confidence label roster_line

  if [ -d "$PROFILES_DIR" ]; then
    while IFS= read -r profile_file; do
      profile_files+=("$profile_file")
    done < <(find "$PROFILES_DIR" -maxdepth 1 -type f -name '*.json' | sort)
  fi

  if [ "${#profile_files[@]}" -eq 0 ]; then
    echo "Roster: N/A"
    return
  fi

  declare -A role_by_id=()
  declare -A conf_by_id=()
  declare -A seen_by_id=()
  declare -a seen_order=()
  declare -a roster_entries=()
  declare -a ordered_ids=(
    "claude-code"
    "codex"
    "gemini"
    "chatgpt-deep-research"
    "deepseek"
    "grok"
  )

  for profile_file in "${profile_files[@]}"; do
    parsed="$(extract_profile_entry "$profile_file")"
    if [ -n "$parsed" ]; then
      IFS=$'\t' read -r profile_id role confidence <<< "$parsed"
    else
      profile_id="$(basename "$profile_file" .json)"
      role="TBD"
      confidence="0"
    fi

    [ -z "$profile_id" ] && profile_id="$(basename "$profile_file" .json)"
    [ -z "$role" ] && role="TBD"
    [ -z "$confidence" ] && confidence="0"

    role_by_id["$profile_id"]="$role"
    conf_by_id["$profile_id"]="$confidence"
    seen_order+=("$profile_id")
  done

  for profile_id in "${ordered_ids[@]}"; do
    if [ -n "${role_by_id[$profile_id]+x}" ]; then
      label="$(profile_label "$profile_id")"
      roster_entries+=("${label}(${role_by_id[$profile_id]},${conf_by_id[$profile_id]})")
      seen_by_id["$profile_id"]=1
    fi
  done

  for profile_id in "${seen_order[@]}"; do
    if [ -z "${seen_by_id[$profile_id]+x}" ]; then
      label="$(profile_label "$profile_id")"
      roster_entries+=("${label}(${role_by_id[$profile_id]},${conf_by_id[$profile_id]})")
      seen_by_id["$profile_id"]=1
    fi
  done

  if [ "${#roster_entries[@]}" -eq 0 ]; then
    echo "Roster: N/A"
  else
    roster_line="$(IFS=' | '; printf '%s' "${roster_entries[*]}")"
    echo "Roster: $roster_line"
  fi
}

resolve_project_state_path() {
  local ref_path="${1:-}"

  if [ -z "$ref_path" ] || [ "$ref_path" = "N/A" ]; then
    printf ''
    return
  fi

  if [[ "$ref_path" =~ ^[A-Za-z]:/ ]] || [[ "$ref_path" =~ ^/ ]]; then
    printf '%s' "$ref_path"
  else
    printf '%s/%s' "$AGENT_DIR" "$ref_path"
  fi
}

current_project="N/A"
active_task="N/A"
last_synced_observation_id="N/A"
project_state_ref="N/A"

if [ -f "$SESSION_FILE" ]; then
  current_project="$(jq -r '.current_project // "N/A"' "$SESSION_FILE" 2>/dev/null || printf 'N/A')"
  active_task="$(jq -r '.active_task // "N/A"' "$SESSION_FILE" 2>/dev/null || printf 'N/A')"
  last_synced_observation_id="$(jq -r '.last_synced_observation_id // "N/A"' "$SESSION_FILE" 2>/dev/null || printf 'N/A')"
  project_state_ref="$(jq -r '.project_state_file // "N/A"' "$SESSION_FILE" 2>/dev/null || printf 'N/A')"
fi

project_state_file="$(resolve_project_state_path "$project_state_ref")"
project_status="N/A"
deployment_info="N/A"
open_issue_count="N/A"
open_issue_titles="N/A"

if [ -n "$project_state_file" ] && [ -f "$project_state_file" ]; then
  project_status="$(jq -r '.status // "N/A"' "$project_state_file" 2>/dev/null || printf 'N/A')"
  deployment_info="$(jq -r '.deployment.status // .deployment.platform // "N/A"' "$project_state_file" 2>/dev/null || printf 'N/A')"
  open_issue_count="$(jq -r '(.open_issues // []) | length' "$project_state_file" 2>/dev/null || printf 'N/A')"
  open_issue_titles="$(jq -r '(.open_issues // [] | map(.title // .id // "untitled") | join("; ")) // "N/A"' "$project_state_file" 2>/dev/null || printf 'N/A')"
fi

active_task="$(trim_text "$active_task" 140)"
deployment_info="$(trim_text "$deployment_info" 120)"
open_issue_titles="$(trim_text "$open_issue_titles" 120)"

declare -a recent_observations=()
if [ -f "$OBS_LOG_FILE" ]; then
  while IFS=$'\t' read -r obs_id obs_summary; do
    [ -z "$obs_id" ] && continue
    obs_summary="$(trim_text "${obs_summary:-N/A}" 120)"
    if [ "${#recent_observations[@]}" -eq 0 ]; then
      recent_observations+=("Last obs #${obs_id}: ${obs_summary}")
    else
      recent_observations+=("Obs #${obs_id}: ${obs_summary}")
    fi
  done < <(
    jq -r '
      if type == "array" then
        sort_by((.id // 0) | tonumber? // 0)
        | reverse
        | .[:3]
        | .[]
        | [(.id // "N/A"), (.task_summary // "N/A")] | @tsv
      else
        empty
      end
    ' "$OBS_LOG_FILE" 2>/dev/null
  )
fi

if [ "${#recent_observations[@]}" -eq 0 ]; then
  recent_observations+=("Last obs #N/A: N/A")
fi

echo "=== LLM Routing Intelligence (Agent Repo) ==="
print_roster
echo "Project: ${current_project} | Status: ${project_status}"
echo "Task: ${active_task}"
echo "Synced observation: ${last_synced_observation_id}"
echo "Deployment: ${deployment_info}"
echo "Open issues: ${open_issue_count} (${open_issue_titles})"
for obs_line in "${recent_observations[@]}"; do
  echo "$obs_line"
done
echo "Tools: stage-dispatch.ps1 | harvest-responses.ps1 | route-task.ps1 | codex-runner.sh | parallel-codex-runner.py"
