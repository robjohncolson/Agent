#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  runner/codex-runner.sh [options]

Note:
  This runner is the Phase 3 sequential executor.
  For Phase 5 parallel branch-per-agent execution, use:
    python runner/parallel-codex-runner.py

Options:
  --prompt-glob <glob>     Prompt glob relative to repo root.
                           Default: specs/codex/phase-*.md
  --state-file <path>      Progress file path (relative to repo root unless absolute).
                           Default: state/codex-progress.json
  --error-log <path>       Error log path (relative to repo root unless absolute).
                           Default: state/codex-runner-errors.log
  --codex-log-dir <path>   Directory for per-phase Codex logs.
                           Default: state/codex-logs
  --codex-bin <command>    Codex binary.
                           Default: codex
  --verify-cmd <command>   Verification command. Repeat for multiple commands.
                           Example: --verify-cmd "pytest" --verify-cmd "ruff check ."
  --no-default-verify      Disable auto-detected default verification commands.
  --cc-gate                Pause between phases for manual CC review.
  --require-clean          Require clean worktree (except runner artifacts).
  --reset                  Reset state before starting.
  --dry-run                Skip Codex, verify, and git commit; still updates state.
  -h, --help               Show this help text.

Flow:
  read prompt -> codex exec --full-auto - -> verify -> git commit -> update progress

Resume behavior:
  Re-running the script skips completed phases and retries failed/pending phases.
EOF
}

if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "Error: run inside a git repository." >&2
  exit 1
fi

PYTHON_CMD=()
if command -v python >/dev/null 2>&1; then
  PYTHON_CMD=(python)
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD=(python3)
elif command -v py >/dev/null 2>&1; then
  PYTHON_CMD=(py -3)
else
  echo "Error: Python is required (python, python3, or py -3)." >&2
  exit 1
fi

PROMPT_GLOB="specs/codex/phase-*.md"
STATE_FILE="state/codex-progress.json"
ERROR_LOG="state/codex-runner-errors.log"
CODEX_LOG_DIR="state/codex-logs"
CODEX_BIN="${CODEX_BIN:-codex}"
RESET_STATE=false
CC_GATE=false
DRY_RUN=false
AUTO_DEFAULT_VERIFY=true
REQUIRE_CLEAN=false
VERIFY_CMDS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-glob)
      PROMPT_GLOB="${2:-}"
      shift 2
      ;;
    --state-file)
      STATE_FILE="${2:-}"
      shift 2
      ;;
    --error-log)
      ERROR_LOG="${2:-}"
      shift 2
      ;;
    --codex-log-dir)
      CODEX_LOG_DIR="${2:-}"
      shift 2
      ;;
    --codex-bin)
      CODEX_BIN="${2:-}"
      shift 2
      ;;
    --verify-cmd)
      VERIFY_CMDS+=("${2:-}")
      AUTO_DEFAULT_VERIFY=false
      shift 2
      ;;
    --no-default-verify)
      AUTO_DEFAULT_VERIFY=false
      shift
      ;;
    --cc-gate)
      CC_GATE=true
      shift
      ;;
    --require-clean)
      REQUIRE_CLEAN=true
      shift
      ;;
    --reset)
      RESET_STATE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument '$1'" >&2
      usage >&2
      exit 1
      ;;
  esac
done

to_abs_path() {
  local maybe_rel="$1"
  if [[ "$maybe_rel" = /* ]]; then
    printf '%s\n' "$maybe_rel"
  else
    printf '%s\n' "$REPO_ROOT/$maybe_rel"
  fi
}

to_repo_rel_path() {
  local abs_path="$1"
  "${PYTHON_CMD[@]}" - "$REPO_ROOT" "$abs_path" <<'PY'
import os
import sys
repo = os.path.abspath(sys.argv[1])
target = os.path.abspath(sys.argv[2])
print(os.path.relpath(target, repo).replace("\\", "/"))
PY
}

STATE_FILE_ABS="$(to_abs_path "$STATE_FILE")"
ERROR_LOG_ABS="$(to_abs_path "$ERROR_LOG")"
CODEX_LOG_DIR_ABS="$(to_abs_path "$CODEX_LOG_DIR")"
STATE_FILE_REL="$(to_repo_rel_path "$STATE_FILE_ABS")"
ERROR_LOG_REL="$(to_repo_rel_path "$ERROR_LOG_ABS")"
CODEX_LOG_DIR_REL="$(to_repo_rel_path "$CODEX_LOG_DIR_ABS")"

mkdir -p "$(dirname "$STATE_FILE_ABS")" "$(dirname "$ERROR_LOG_ABS")" "$CODEX_LOG_DIR_ABS"

collect_prompt_files() {
  local glob_pattern="$1"
  (
    cd "$REPO_ROOT"
    shopt -s nullglob
    local files=( $glob_pattern )
    shopt -u nullglob
    printf '%s\n' "${files[@]}"
  ) | LC_ALL=C sort -V
}

is_runner_artifact_path() {
  local path="$1"
  [[ "$path" == "$STATE_FILE_REL" ]] && return 0
  [[ "$path" == "$ERROR_LOG_REL" ]] && return 0
  [[ "$path" == "$CODEX_LOG_DIR_REL"/* ]] && return 0
  return 1
}

verify_clean_worktree() {
  local dirty=()
  local path
  mapfile -t dirty < <(
    cd "$REPO_ROOT"
    {
      git diff --name-only
      git diff --name-only --cached
      git ls-files --others --exclude-standard
    } | LC_ALL=C sort -u
  )

  local non_runner_dirty=()
  for path in "${dirty[@]}"; do
    [[ -z "$path" ]] && continue
    if ! is_runner_artifact_path "$path"; then
      non_runner_dirty+=("$path")
    fi
  done

  if [[ ${#non_runner_dirty[@]} -gt 0 ]]; then
    echo "Error: worktree has uncommitted changes outside runner artifacts." >&2
    printf '%s\n' "${non_runner_dirty[@]}" >&2
    exit 1
  fi
}

to_json_array() {
  "${PYTHON_CMD[@]}" - "$@" <<'PY'
import json
import sys
print(json.dumps(sys.argv[1:]))
PY
}

state_ctl() {
  local action="$1"
  shift
  "${PYTHON_CMD[@]}" - "$STATE_FILE_ABS" "$action" "$@" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

state_path = sys.argv[1]
action = sys.argv[2]
args = sys.argv[3:]
valid_status = {"pending", "running", "completed", "failed"}

def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def load_state():
    if not os.path.exists(state_path):
        return {}
    with open(state_path, "r", encoding="utf-8") as fh:
        return json.load(fh)

def summarize(state):
    phases = state.get("phases", [])
    total = len(phases)
    completed = sum(1 for p in phases if p.get("status") == "completed")
    failed = sum(1 for p in phases if p.get("status") == "failed")
    running = sum(1 for p in phases if p.get("status") == "running")
    pending = total - completed - failed - running
    state["summary"] = {
        "total": total,
        "completed": completed,
        "failed": failed,
        "running": running,
        "pending": pending,
    }
    if total > 0 and completed == total:
        state["status"] = "completed"
        state["current_phase"] = None
    elif running > 0:
        state["status"] = "running"
    elif failed > 0 and state.get("status") != "paused":
        state["status"] = "failed"
    elif state.get("status") != "paused":
        state["status"] = "idle"

def save_state(state):
    state["updated_at"] = now_iso()
    summarize(state)
    state_dir = os.path.dirname(state_path) or "."
    os.makedirs(state_dir, exist_ok=True)
    with open(state_path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)
        fh.write("\n")

def find_phase(state, phase_file):
    for phase in state.get("phases", []):
        if phase.get("file") == phase_file:
            return phase
    raise SystemExit(f"Phase not found in state: {phase_file}")

if action == "sync":
    prompt_glob = args[0]
    verify_cmds = json.loads(args[1])
    cc_gate = args[2].lower() == "true"
    prompt_files = args[3:]

    prev = load_state()
    prev_phases = {p.get("file"): p for p in prev.get("phases", []) if p.get("file")}
    merged_phases = []

    for idx, phase_file in enumerate(prompt_files, start=1):
        old = prev_phases.get(phase_file, {})
        status = old.get("status", "pending")
        if status not in valid_status:
            status = "pending"
        error = old.get("error")
        if status == "running":
            status = "failed"
            error = {
                "step": "runner",
                "message": "Recovered from interrupted run.",
                "exit_code": None,
                "timestamp": now_iso(),
            }
        merged = {
            "index": idx,
            "file": phase_file,
            "status": status,
            "attempts": int(old.get("attempts", 0)),
            "started_at": old.get("started_at"),
            "finished_at": old.get("finished_at"),
            "commit": old.get("commit") if status == "completed" else None,
            "codex_log": old.get("codex_log"),
            "verify_results": old.get("verify_results", []),
            "error": error if status == "failed" else None,
        }
        if status == "pending":
            merged["started_at"] = None
            merged["finished_at"] = None
            merged["codex_log"] = None
            merged["verify_results"] = []
        merged_phases.append(merged)

    state = {
        "version": 1,
        "project": prev.get("project") or os.path.basename(os.getcwd()),
        "status": prev.get("status", "idle"),
        "current_phase": prev.get("current_phase"),
        "prompt_glob": prompt_glob,
        "verify_commands": verify_cmds,
        "cc_gate": cc_gate,
        "last_error": prev.get("last_error"),
        "phases": merged_phases,
    }

    if state.get("last_error"):
        err_phase = state["last_error"].get("phase")
        matching = [p for p in merged_phases if p.get("file") == err_phase and p.get("status") == "failed"]
        if not matching:
            state["last_error"] = None

    save_state(state)
elif action == "phase-status":
    state = load_state()
    phase = find_phase(state, args[0])
    print(phase.get("status", "pending"))
elif action == "mark-running":
    state = load_state()
    phase = find_phase(state, args[0])
    phase["status"] = "running"
    phase["attempts"] = int(phase.get("attempts", 0)) + 1
    phase["started_at"] = now_iso()
    phase["finished_at"] = None
    phase["codex_log"] = args[1]
    phase["verify_results"] = []
    phase["error"] = None
    state["status"] = "running"
    state["current_phase"] = args[0]
    state["last_error"] = None
    save_state(state)
elif action == "append-verify":
    state = load_state()
    phase = find_phase(state, args[0])
    results = phase.get("verify_results", [])
    results.append({
        "command": args[1],
        "exit_code": int(args[2]),
        "timestamp": now_iso(),
    })
    phase["verify_results"] = results
    save_state(state)
elif action == "mark-failed":
    state = load_state()
    phase = find_phase(state, args[0])
    step = args[1]
    exit_code = None if args[2] in {"", "None", "null"} else int(args[2])
    message = args[3]
    failure = {
        "step": step,
        "message": message,
        "exit_code": exit_code,
        "timestamp": now_iso(),
    }
    phase["status"] = "failed"
    phase["finished_at"] = now_iso()
    phase["error"] = failure
    state["status"] = "failed"
    state["current_phase"] = args[0]
    state["last_error"] = {"phase": args[0], **failure}
    save_state(state)
elif action == "mark-completed":
    state = load_state()
    phase = find_phase(state, args[0])
    phase["status"] = "completed"
    phase["finished_at"] = now_iso()
    phase["commit"] = args[1]
    phase["error"] = None
    state["current_phase"] = None
    state["last_error"] = None
    save_state(state)
elif action == "set-paused":
    state = load_state()
    state["status"] = "paused"
    state["current_phase"] = None
    save_state(state)
elif action == "summary":
    state = load_state()
    summary = state.get("summary", {})
    print(json.dumps(summary))
else:
    raise SystemExit(f"Unknown state action: {action}")
PY
}

log_failure() {
  local phase_file="$1"
  local step="$2"
  local exit_code="$3"
  local message="$4"
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf '[%s] phase=%s step=%s exit=%s message=%s\n' "$ts" "$phase_file" "$step" "$exit_code" "$message" >> "$ERROR_LOG_ABS"
}

fail_phase_and_exit() {
  local phase_file="$1"
  local step="$2"
  local exit_code="$3"
  local message="$4"
  log_failure "$phase_file" "$step" "$exit_code" "$message"
  state_ctl mark-failed "$phase_file" "$step" "$exit_code" "$message"
  echo "Phase failed at $phase_file ($step): $message" >&2
  echo "Fix the issue, then rerun to resume." >&2
  exit 1
}

build_commit_message() {
  local phase_file="$1"
  local base_name
  base_name="$(basename "$phase_file" .md)"
  if [[ "$base_name" =~ ^phase-([0-9]+)-(.+)$ ]]; then
    local phase_num="${BASH_REMATCH[1]}"
    local phase_title="${BASH_REMATCH[2]//-/ }"
    printf 'Phase %s: %s\n' "$phase_num" "$phase_title"
  else
    printf 'Phase: %s\n' "$base_name"
  fi
}

run_verify_command() {
  local cmd="$1"
  set +e
  (
    cd "$REPO_ROOT"
    bash -lc "$cmd"
  )
  local verify_exit=$?
  set -e
  return "$verify_exit"
}

run_codex_for_phase() {
  local phase_abs="$1"
  local codex_log_abs="$2"
  set +e
  (
    cd "$REPO_ROOT"
    "$CODEX_BIN" exec --full-auto - < "$phase_abs"
  ) 2>&1 | tee "$codex_log_abs"
  local codex_exit="${PIPESTATUS[0]}"
  set -e
  return "$codex_exit"
}

commit_phase_changes() {
  local commit_msg="$1"
  (
    cd "$REPO_ROOT"
    git add -A
    git reset -q HEAD -- "$STATE_FILE_REL" "$ERROR_LOG_REL" "$CODEX_LOG_DIR_REL" 2>/dev/null || true
    if git diff --cached --quiet; then
      return 3
    fi
    git commit -m "$commit_msg"
  )
}

if [[ "$AUTO_DEFAULT_VERIFY" == "true" && ${#VERIFY_CMDS[@]} -eq 0 ]]; then
  if command -v pytest >/dev/null 2>&1; then
    VERIFY_CMDS+=("pytest")
  fi
  if command -v ruff >/dev/null 2>&1; then
    VERIFY_CMDS+=("ruff check .")
  elif command -v npm >/dev/null 2>&1 && [[ -f "$REPO_ROOT/package.json" ]]; then
    VERIFY_CMDS+=("npm run lint --if-present")
  fi
fi

if [[ ${#VERIFY_CMDS[@]} -eq 0 && "$DRY_RUN" != "true" ]]; then
  echo "Error: no verification commands configured." >&2
  echo "Pass --verify-cmd or install tools for default verify detection." >&2
  exit 1
fi

mapfile -t PROMPT_FILES < <(collect_prompt_files "$PROMPT_GLOB")
if [[ ${#PROMPT_FILES[@]} -eq 0 ]]; then
  echo "Error: no prompt files matched '$PROMPT_GLOB'" >&2
  exit 1
fi

if [[ "$RESET_STATE" == "true" ]]; then
  rm -f "$STATE_FILE_ABS"
fi

VERIFY_JSON="$(to_json_array "${VERIFY_CMDS[@]}")"
state_ctl sync "$PROMPT_GLOB" "$VERIFY_JSON" "$CC_GATE" "${PROMPT_FILES[@]}"

if [[ "$REQUIRE_CLEAN" == "true" ]]; then
  verify_clean_worktree
fi

total_phases="${#PROMPT_FILES[@]}"
for idx in "${!PROMPT_FILES[@]}"; do
  phase_file="${PROMPT_FILES[$idx]}"
  phase_status="$(state_ctl phase-status "$phase_file")"

  if [[ "$phase_status" == "completed" ]]; then
    echo "Skipping completed phase: $phase_file"
    continue
  fi

  phase_abs="$REPO_ROOT/$phase_file"
  phase_base="$(basename "$phase_file" .md)"
  phase_stamp="$(date -u +"%Y%m%dT%H%M%SZ")"
  codex_log_rel="$CODEX_LOG_DIR_REL/${phase_base}-${phase_stamp}.log"
  codex_log_abs="$REPO_ROOT/$codex_log_rel"
  mkdir -p "$(dirname "$codex_log_abs")"
  state_ctl mark-running "$phase_file" "$codex_log_rel"

  echo "Running phase $((idx + 1))/$total_phases: $phase_file"

  if [[ "$DRY_RUN" == "true" ]]; then
    printf '[DRY RUN] skipped: %s exec --full-auto - < %s\n' "$CODEX_BIN" "$phase_file" | tee "$codex_log_abs"
  else
    set +e
    run_codex_for_phase "$phase_abs" "$codex_log_abs"
    codex_exit=$?
    set -e
    if [[ "$codex_exit" -ne 0 ]]; then
      fail_phase_and_exit "$phase_file" "codex" "$codex_exit" "Codex failed (see $codex_log_rel)"
    fi
  fi

  for verify_cmd in "${VERIFY_CMDS[@]}"; do
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[DRY RUN] verify: $verify_cmd"
      state_ctl append-verify "$phase_file" "$verify_cmd" "0"
      continue
    fi
    echo "Verify: $verify_cmd"
    if run_verify_command "$verify_cmd"; then
      state_ctl append-verify "$phase_file" "$verify_cmd" "0"
    else
      verify_exit=$?
      state_ctl append-verify "$phase_file" "$verify_cmd" "$verify_exit"
      fail_phase_and_exit "$phase_file" "verify" "$verify_exit" "Verification failed: $verify_cmd"
    fi
  done

  commit_sha="dry-run"
  if [[ "$DRY_RUN" != "true" ]]; then
    commit_msg="$(build_commit_message "$phase_file")"
    set +e
    commit_phase_changes "$commit_msg"
    commit_exit=$?
    set -e
    if [[ "$commit_exit" -ne 0 ]]; then
      if [[ "$commit_exit" -eq 3 ]]; then
        fail_phase_and_exit "$phase_file" "git-commit" "$commit_exit" "No changes to commit after phase."
      fi
      fail_phase_and_exit "$phase_file" "git-commit" "$commit_exit" "git commit failed."
    fi
    commit_sha="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  fi

  state_ctl mark-completed "$phase_file" "$commit_sha"
  echo "Completed $phase_file at commit $commit_sha"

  if [[ "$CC_GATE" == "true" && "$idx" -lt $((total_phases - 1)) ]]; then
    echo "CC gate enabled: review changes/output before next phase."
    read -r -p "Continue to next phase? [y/N] " gate_answer
    if [[ ! "$gate_answer" =~ ^([yY]|[yY][eE][sS])$ ]]; then
      state_ctl set-paused
      echo "Paused by CC gate. Re-run to resume."
      exit 0
    fi
  fi
done

echo "All phases completed."
echo "Progress file: $STATE_FILE_REL"
