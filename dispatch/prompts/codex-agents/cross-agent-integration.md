# Codex Prompt: Agent E — Cross-Agent Integration Tests

## Context

You are working in the Agent repo at `C:\Users\rober\Downloads\Projects\Agent`.

Four other agents have already created the cross-agent subsystem:
- **Agent A** created `runner/cross-agent.py` (the runner script)
- **Agent B** created JSON schemas in `schema/cross-agent-*.schema.json`
- **Agent C** created preamble templates in `dispatch/prompts/subagent-preambles/`
- **Agent D** created `hooks/cross-agent-log.py` (the logging hook)

Your job is to create a test harness that validates the entire pipeline works end-to-end **without actually invoking real CC or Codex instances**. Tests must use mocking/simulation.

Read `design/cross-agent-spec.md` for the full specification.

## Task

Create two test files:

### 1. `scripts/test-cross-agent.py` — Python Test Suite

A pytest-compatible test file (but must also work with `python scripts/test-cross-agent.py` via `unittest`). Stdlib only — use `unittest` and `unittest.mock`, no pytest import required.

#### Test Cases

**Group 1: Envelope and Payload Construction**

- `test_build_envelope_cc_to_codex`: Verify `build_envelope()` produces valid JSON matching the request schema. Check that `direction=cc-to-codex` sets `caller=claude-code`.
- `test_build_envelope_codex_to_cc`: Same but for `direction=codex-to-cc`, `caller=codex`.
- `test_build_payload_task_types`: For each task_type (`implement`, `review`, `investigate`, `validate`, `design-question`), verify the correct `expected_output` is set.
- `test_build_payload_owned_paths`: Verify owned_paths from CLI args are passed through correctly.
- `test_build_payload_read_only`: Verify `--read-only` flag sets `constraints.read_only = true`.

**Group 2: Depth Guard**

- `test_depth_zero_allowed`: `check_depth(0, 1)` should not raise or exit.
- `test_depth_at_max_blocked`: `check_depth(1, 1)` should exit with code 0 and write a refused result file.
- `test_depth_above_max_blocked`: `check_depth(2, 1)` should exit with code 0.

**Group 3: Prompt Assembly**

- `test_assemble_prompt_cc_to_codex`: Verify the assembled prompt starts with the Codex-as-subagent preamble, contains `{call_id}` replaced with actual call_id, and contains the task payload JSON.
- `test_assemble_prompt_codex_to_cc`: Same but with CC-as-subagent preamble.
- `test_assemble_prompt_missing_preamble`: When preamble files don't exist, verify the fallback hardcoded preamble is used (no crash).

**Group 4: Result Parsing**

- `test_parse_result_valid`: Write a valid result JSON to `state/cross-agent/{call_id}.result.json`, verify `parse_result()` returns it correctly.
- `test_parse_result_missing_file`: When no result file exists, verify a failure result is constructed with `status: "failed"`.
- `test_parse_result_corrupt_json`: Write invalid JSON to the result file, verify graceful failure result.

**Group 5: Log Management**

- `test_log_call_creates_file`: On first call, `log_call()` should create `cross-agent-log.json` with correct structure.
- `test_log_call_appends`: After two calls, verify `calls` array has 2 entries and `summary.total_calls == 2`.
- `test_log_call_summary_counters`: After one cc-to-codex completed and one codex-to-cc failed, verify all summary counters are correct.
- `test_log_call_avg_duration`: After calls with durations 10 and 20, verify `avg_duration_seconds == 15`.

**Group 6: Schema Validation**

- `test_request_schema_valid`: Load `schema/cross-agent-request.schema.json`, verify it's valid JSON and has the expected top-level fields.
- `test_result_schema_valid`: Same for `schema/cross-agent-result.schema.json`.
- `test_log_schema_valid`: Same for `schema/cross-agent-log.schema.json`.

**Group 7: End-to-End (mocked)**

- `test_e2e_dry_run_cc_to_codex`: Run `python runner/cross-agent.py --direction cc-to-codex --task-type implement --prompt "test task" --working-dir . --dry-run` via `subprocess.run`. Verify exit code 0, stdout contains preamble and task payload.
- `test_e2e_dry_run_codex_to_cc`: Same for `codex-to-cc` direction.

#### Implementation Requirements

- Import the runner module: `sys.path.insert(0, "runner")` then `import cross_agent` (the runner file without `.py`)
  - If import fails (Agent A's file not merged yet), skip tests with `@unittest.skipIf`
- Use `tempfile.TemporaryDirectory` for all file I/O tests — never write to the real `state/` directory
- Use `unittest.mock.patch` for any subprocess calls
- Each test is independent — no shared state between tests
- Test class: `class TestCrossAgent(unittest.TestCase)`
- Main block: `if __name__ == "__main__": unittest.main()`

### 2. `scripts/test-cross-agent.sh` — Shell Smoke Test

A bash script that runs quick validation checks. Must work on Windows/MSYS2 (Git Bash).

```bash
#!/bin/bash
# Cross-agent subsystem smoke tests
# Usage: bash scripts/test-cross-agent.sh

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; ((PASS++)); }
fail() { echo "  FAIL: $1"; ((FAIL++)); }
```

#### Smoke Checks

1. **File existence**: Verify all expected files exist:
   - `runner/cross-agent.py`
   - `schema/cross-agent-request.schema.json`
   - `schema/cross-agent-result.schema.json`
   - `schema/cross-agent-log.schema.json`
   - `dispatch/prompts/subagent-preambles/cc-as-subagent.md`
   - `dispatch/prompts/subagent-preambles/codex-as-subagent.md`
   - `hooks/cross-agent-log.py`

2. **Syntax checks**:
   - `python -m py_compile runner/cross-agent.py`
   - `python -m py_compile hooks/cross-agent-log.py`
   - Validate each schema file is valid JSON: `python -c "import json; json.load(open('...'))"` for each

3. **CLI help**: `python runner/cross-agent.py --help` exits 0

4. **Dry run**: `python runner/cross-agent.py --direction cc-to-codex --task-type implement --prompt "smoke test" --working-dir "$AGENT_DIR" --dry-run` exits 0 and stdout is non-empty

5. **Preamble template variables**: `grep -c '{call_id}' dispatch/prompts/subagent-preambles/cc-as-subagent.md` returns a count > 0 (template variables present)

6. **Hook no-args**: `python hooks/cross-agent-log.py` exits 0 (no crash on empty invocation)

7. **Schema structure**: For each schema file, verify `python -c "import json; d=json.load(open('...')); assert '$schema' in d; assert 'properties' in d"`

Print summary at end:
```
Cross-agent smoke tests: {PASS} passed, {FAIL} failed
```
Exit 1 if any failures, exit 0 if all pass.

## Files You Create

```
scripts/test-cross-agent.py    # NEW — Python test suite
scripts/test-cross-agent.sh    # NEW — Bash smoke tests
```

## Files You May Read (for reference)

- `runner/cross-agent.py` — the module under test
- `hooks/cross-agent-log.py` — the hook under test
- `schema/cross-agent-*.schema.json` — schemas to validate
- `dispatch/prompts/subagent-preambles/*.md` — templates to check
- `design/cross-agent-spec.md` — specification

## Files You May NOT Modify

- Anything outside `scripts/`
- Do not modify any file created by Agents A-D

## Validation

After creating the test files:
1. `python -m py_compile scripts/test-cross-agent.py` (syntax check)
2. `bash -n scripts/test-cross-agent.sh` (syntax check)
3. `bash scripts/test-cross-agent.sh` (run smoke tests — some may fail if Agent A-D files aren't merged yet, that's OK)
4. `python scripts/test-cross-agent.py` (run unit tests — some may skip if imports aren't available)
