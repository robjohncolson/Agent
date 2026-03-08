#!/usr/bin/env bash
# Dispatch improvement-spec agents via Codex directly in dependency-ordered batches.
# Usage: bash dispatch/run-improvement-spec.sh [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPT_DIR="$AGENT_ROOT/dispatch/prompts/improvement-spec"
LOG_DIR="$AGENT_ROOT/state/improvement-spec-logs"
CODEX_JS="C:/Users/ColsonR/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js"
DRY_RUN="${1:-}"

mkdir -p "$LOG_DIR"

dispatch_agent() {
  local name="$1"
  local prompt_file="$2"
  local working_dir="$3"
  shift 3
  # remaining args are owned_paths (for logging only — codex doesn't enforce them)

  local log_file="$LOG_DIR/${name}.log"
  local prompt_path="$PROMPT_DIR/$prompt_file"

  echo "[$(date -u +%H:%M:%S)] START  $name -> $working_dir"

  if [[ "$DRY_RUN" == "--dry-run" ]]; then
    echo "DRY RUN: node $CODEX_JS exec --full-auto -C $working_dir < $prompt_path" > "$log_file"
    echo "[$(date -u +%H:%M:%S)] DRYRUN $name"
    return 0
  fi

  # Pipe prompt file into codex exec with working dir set
  if node "$CODEX_JS" exec --full-auto --skip-git-repo-check -C "$working_dir" - < "$prompt_path" > "$log_file" 2>&1; then
    echo "[$(date -u +%H:%M:%S)] OK     $name"
  else
    echo "[$(date -u +%H:%M:%S)] FAIL   $name (exit $?, see $log_file)"
  fi
}

wait_for_batch() {
  local label="$1"
  echo ""
  echo "=== Waiting for $label ==="
  wait
  echo "=== $label complete ==="
  echo ""
}

HOME_DIR="C:/Users/ColsonR"
GRIDBOT="C:/Users/ColsonR/grid-bot-v2"
DRILLER="C:/Users/ColsonR/lrsl-driller"
CURRIC="C:/Users/ColsonR/curriculum_render"
APSTATS="C:/Users/ColsonR/apstats-live-worksheet"
AGENT="C:/Users/ColsonR/Agent"

echo "============================================"
echo "  Improvement Spec Dispatch — Direct Codex"
echo "  22 agents, 5 sub-batches"
echo "  $(date -u)"
echo "============================================"
echo ""

# ─── BATCH 1a: P1 Foundation (5 agents, config only) ───
echo ">>> Batch 1a: P1 Foundation (5 agents)"
dispatch_agent "P1-01-claude-md-global"    "P1-01-claude-md-global.md"      "$HOME_DIR"  ".claude/CLAUDE.md" &
dispatch_agent "P1-02-claude-md-gridbot"   "P1-02-claude-md-gridbot-v2.md"  "$GRIDBOT"   "CLAUDE.md" &
dispatch_agent "P1-03-claude-md-education" "P1-03-claude-md-education.md"   "$DRILLER"   "CLAUDE.md" &
dispatch_agent "P1-04-custom-skills"       "P1-04-custom-skills.md"         "$HOME_DIR"  ".claude/skills" &
dispatch_agent "P1-05-hooks-setup"         "P1-05-hooks-setup.md"           "$HOME_DIR"  ".claude/settings.json" &
wait_for_batch "Batch 1a: P1 Foundation"

# ─── BATCH 1b: P2 Tests + P3 Tests (5 agents) ───
echo ">>> Batch 1b: P2/P3 Tests (5 agents)"
dispatch_agent "P2-01-test-fill-detection"         "P2-01-test-fill-detection.md"         "$GRIDBOT"   "test_fill_detection_paths.py" "conftest.py" &
dispatch_agent "P2-02-test-startup-reconciliation"  "P2-02-test-startup-reconciliation.md"  "$GRIDBOT"   "test_startup_reconciliation.py" &
dispatch_agent "P2-03-test-orphan-paths"            "P2-03-test-orphan-paths.md"            "$GRIDBOT"   "test_orphan_recovery_paths.py" &
dispatch_agent "P2-05-test-degraded-modes"          "P2-05-test-degraded-modes.md"          "$GRIDBOT"   "test_degraded_mode_transitions.py" &
dispatch_agent "P3-01-test-deep-link"               "P3-01-test-deep-link.md"               "$DRILLER"   "tests/deep-link-roundtrip.test.js" &
wait_for_batch "Batch 1b: P2/P3 Tests"

# ─── BATCH 1c: Remaining no-deps (5 agents) ───
echo ">>> Batch 1c: Remaining no-deps (5 agents)"
dispatch_agent "P3-02-test-progression"         "P3-02-test-progression.md"         "$DRILLER"   "tests/progression-regression.test.js" &
dispatch_agent "P3-04-test-grading-escalation"  "P3-04-test-grading-escalation.md"  "$CURRIC"    "tests/grading/escalation-e2e.test.js" &
dispatch_agent "P4-01-whisper-integration"      "P4-01-whisper-integration.md"      "$APSTATS"   "video-ingest-whisper.mjs" &
dispatch_agent "P4-02-headless-executor"        "P4-02-headless-executor.md"        "$AGENT"     "runner/parallel-codex-runner.py" &
dispatch_agent "P5-01-shared-grading-proxy"     "P5-01-shared-grading-proxy.md"     "$HOME_DIR"  "shared-grading-proxy" &
wait_for_batch "Batch 1c: Remaining no-deps"

# ─── BATCH 2: Depends on batch 1 (5 agents) ───
echo ">>> Batch 2: Dependent agents (5 agents)"
dispatch_agent "P2-04-test-fee-integration"    "P2-04-test-fee-integration.md"    "$GRIDBOT"   "test_fee_integration.py" &
dispatch_agent "P3-03-extract-url-state"       "P3-03-extract-url-state.md"       "$DRILLER"   "platform/core/url-state.js" &
dispatch_agent "P4-03-lessonprep-orchestrator" "P4-03-lessonprep-orchestrator.md" "$APSTATS"   "Agent/scripts/lesson-prep.mjs" &
dispatch_agent "P5-02-wire-grading-cr"         "P5-02-wire-grading-cr.md"         "$CURRIC"    "railway-server/server.js" &
dispatch_agent "P5-03-wire-grading-driller"    "P5-03-wire-grading-driller.md"    "$DRILLER"   "platform/core/grading-engine.js" &
wait_for_batch "Batch 2: Dependent agents"

# ─── BATCH 3: Final fan-in (2 agents) ───
echo ">>> Batch 3: Final fan-in (2 agents)"
dispatch_agent "P2-06-ci-setup"                "P2-06-ci-setup.md"                "$GRIDBOT"   ".github/workflows" &
dispatch_agent "P5-04-supabase-consolidation"  "P5-04-supabase-consolidation.md"  "$HOME_DIR"  "shared-grading-proxy/migrations" &
wait_for_batch "Batch 3: Final fan-in"

echo ""
echo "============================================"
echo "  All 22 agents complete"
echo "  Logs: $LOG_DIR/"
echo "  $(date -u)"
echo "============================================"

# Summary
echo ""
echo "=== Results Summary ==="
ok=0; fail=0
for log in "$LOG_DIR"/*.log; do
  name=$(basename "$log" .log)
  size=$(wc -c < "$log")
  if [ "$size" -gt 100 ]; then
    echo "  OK   $name ($(wc -c < "$log") bytes)"
    ((ok++)) || true
  else
    echo "  FAIL $name ($(wc -c < "$log") bytes)"
    ((fail++)) || true
  fi
done
echo ""
echo "Total: $ok OK, $fail FAIL out of 22 agents"
