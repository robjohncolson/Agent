#!/bin/bash
# Cross-agent subsystem smoke tests
# Usage: bash scripts/test-cross-agent.sh

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

check_file_exists() {
  local rel_path="$1"
  if [[ -f "$AGENT_DIR/$rel_path" ]]; then
    pass "exists: $rel_path"
  else
    fail "missing: $rel_path"
  fi
}

echo "Cross-agent smoke tests"

echo "1) File existence"
check_file_exists "runner/cross-agent.py"
check_file_exists "schema/cross-agent-request.schema.json"
check_file_exists "schema/cross-agent-result.schema.json"
check_file_exists "schema/cross-agent-log.schema.json"
check_file_exists "dispatch/prompts/subagent-preambles/cc-as-subagent.md"
check_file_exists "dispatch/prompts/subagent-preambles/codex-as-subagent.md"
check_file_exists "hooks/cross-agent-log.py"

echo "2) Syntax checks"
if python -m py_compile "$AGENT_DIR/runner/cross-agent.py" >/dev/null 2>&1; then
  pass "py_compile runner/cross-agent.py"
else
  fail "py_compile runner/cross-agent.py"
fi

if python -m py_compile "$AGENT_DIR/hooks/cross-agent-log.py" >/dev/null 2>&1; then
  pass "py_compile hooks/cross-agent-log.py"
else
  fail "py_compile hooks/cross-agent-log.py"
fi

for schema in \
  "schema/cross-agent-request.schema.json" \
  "schema/cross-agent-result.schema.json" \
  "schema/cross-agent-log.schema.json"; do
  if python -c "import json,sys; json.load(open(sys.argv[1], encoding='utf-8'))" "$AGENT_DIR/$schema" >/dev/null 2>&1; then
    pass "valid JSON: $schema"
  else
    fail "valid JSON: $schema"
  fi
done

echo "3) CLI help"
if python "$AGENT_DIR/runner/cross-agent.py" --help >/dev/null 2>&1; then
  pass "cross-agent.py --help exits 0"
else
  fail "cross-agent.py --help exits 0"
fi

echo "4) Dry run"
if dry_output="$(python "$AGENT_DIR/runner/cross-agent.py" \
  --direction cc-to-codex \
  --task-type implement \
  --prompt "smoke test" \
  --working-dir "$AGENT_DIR" \
  --codex-bin python \
  --dry-run 2>/dev/null)"; then
  if [[ -n "$dry_output" ]]; then
    pass "dry-run exits 0 with non-empty stdout"
  else
    fail "dry-run exits 0 with non-empty stdout"
  fi
else
  fail "dry-run exits 0 with non-empty stdout"
fi

echo "5) Preamble template variables"
call_id_count="$(grep -c '{call_id}' "$AGENT_DIR/dispatch/prompts/subagent-preambles/cc-as-subagent.md" || true)"
if [[ "$call_id_count" -gt 0 ]]; then
  pass "cc-as-subagent.md contains {call_id}"
else
  fail "cc-as-subagent.md contains {call_id}"
fi

echo "6) Hook no-args"
if python "$AGENT_DIR/hooks/cross-agent-log.py" >/dev/null 2>&1; then
  pass "cross-agent-log.py no-args exits 0"
else
  fail "cross-agent-log.py no-args exits 0"
fi

echo "7) Schema structure"
for schema in \
  "schema/cross-agent-request.schema.json" \
  "schema/cross-agent-result.schema.json" \
  "schema/cross-agent-log.schema.json"; do
  if python -c "import json,sys; d=json.load(open(sys.argv[1], encoding='utf-8')); assert '\$schema' in d; assert 'properties' in d" "$AGENT_DIR/$schema" >/dev/null 2>&1; then
    pass "schema structure: $schema"
  else
    fail "schema structure: $schema"
  fi
done

echo "Cross-agent smoke tests: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
