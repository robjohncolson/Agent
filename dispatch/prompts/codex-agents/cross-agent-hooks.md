# Codex Prompt: Agent D — Cross-Agent Logging Hook

## Context

You are working in the Agent repo at `C:\Users\rober\Downloads\Projects\Agent`.
This repo has an existing hooks system:
- `hooks/codex-notify.py` — updates progress tracking on Codex task completion
- `hooks/cc-session-start.sh` — prints routing summary on CC startup
- `hooks/cc-auto-checkpoint.sh` — saves state before CC context compaction

You are creating a **new hook** that logs cross-agent subagent calls for observability. The cross-agent runner (`runner/cross-agent.py`) will call this hook at two points: when a subagent call starts, and when it completes.

Read `design/cross-agent-spec.md` section "Integration with Hooks" for the specification.
Read `hooks/codex-notify.py` for the existing hook implementation style.

## Task

Create `hooks/cross-agent-log.py` — a Python 3 script (stdlib only).

### Invocation

The cross-agent runner calls this script with a single JSON argument:

```bash
python hooks/cross-agent-log.py '{"event": "request", ...}'
python hooks/cross-agent-log.py '{"event": "result", ...}'
```

### Input Events

#### Request Event (call starting)
```json
{
  "event": "request",
  "call_id": "a1b2c3d4e5f6",
  "direction": "cc-to-codex",
  "task_type": "implement",
  "prompt_summary": "Create a helper function that...",
  "depth": 0,
  "timestamp": "2026-03-02T12:00:00Z",
  "working_dir": "/path/to/repo"
}
```

#### Result Event (call completed)
```json
{
  "event": "result",
  "call_id": "a1b2c3d4e5f6",
  "direction": "cc-to-codex",
  "task_type": "implement",
  "status": "completed",
  "duration_seconds": 23.4,
  "files_changed": ["utils/paths.py"],
  "timestamp": "2026-03-02T12:00:23Z",
  "depth": 0
}
```

### Behavior

#### On `request` event:
1. Validate `depth < max_depth` (if `max_depth` field is present). If violated, log a warning but do NOT block — the runner handles enforcement.
2. Print to stderr: `[cross-agent] Starting {direction} call {call_id}: {prompt_summary}`
3. Optionally notify the user if configured (future — just add a `# TODO` placeholder for now)

#### On `result` event:
1. Read `state/cross-agent-log.json` (create if missing)
2. Append a call entry to the `calls` array:
   ```json
   {
     "call_id": "a1b2c3d4e5f6",
     "direction": "cc-to-codex",
     "task_type": "implement",
     "prompt_summary": "Create a helper function that...",
     "status": "completed",
     "duration_seconds": 23.4,
     "timestamp": "2026-03-02T12:00:23Z",
     "files_changed": ["utils/paths.py"],
     "depth": 0
   }
   ```
   Note: `prompt_summary` may not be in the result event — if missing, use `""`.
3. Update `summary` counters:
   - Increment `total_calls`
   - Increment `cc_to_codex` or `codex_to_cc` based on direction
   - Increment `completed`, `failed`, `refused`, or leave unchanged based on status
   - Recalculate `avg_duration_seconds` as running average
4. Write back atomically (write to `.tmp`, then `os.replace()`)
5. Print to stderr: `[cross-agent] Completed {direction} call {call_id}: {status} ({duration_seconds}s)`

#### On unknown event or malformed input:
- Log to stderr: `[cross-agent] Unknown event or malformed input: {raw_input[:200]}`
- Exit 0 — never crash

### Required Functions

#### `load_log(state_dir: str) -> dict`
Read `cross-agent-log.json` from state_dir. If missing or corrupt, return:
```json
{
  "version": 1,
  "calls": [],
  "summary": {
    "total_calls": 0,
    "cc_to_codex": 0,
    "codex_to_cc": 0,
    "completed": 0,
    "failed": 0,
    "refused": 0,
    "avg_duration_seconds": 0
  }
}
```

#### `save_log(state_dir: str, log: dict) -> None`
Atomic write: write to `cross-agent-log.json.tmp`, then `os.replace()` to `cross-agent-log.json`.

#### `update_summary(summary: dict, direction: str, status: str, duration: float) -> None`
Mutate summary dict in place:
- `total_calls += 1`
- Increment direction counter (`cc_to_codex` or `codex_to_cc`)
- Increment status counter (`completed`, `failed`, or `refused`)
- `avg_duration_seconds = ((avg * (total - 1)) + duration) / total`

#### `main() -> None`
1. Read `sys.argv[1]` — if missing, exit 0 silently
2. Parse JSON — if invalid, log warning to stderr, exit 0
3. Read `event` field — dispatch to request handler or result handler
4. Exit 0

### Implementation Details

- **Stdlib only**: `json`, `os`, `sys`, `pathlib`. No pip packages.
- **State directory**: Default to `C:/Users/rober/Downloads/Projects/Agent/state`. Also check `AGENT_STATE_DIR` environment variable.
- **Path handling**: Use `pathlib.Path` for all path construction. Forward slashes only.
- **Atomic writes**: Follow the same pattern as `hooks/codex-notify.py`.
- **Never crash**: Wrap everything in try/except. Log errors to stderr. Exit 0 always.
- **Encoding**: Open all files with `encoding="utf-8"`.

## Files You Create

```
hooks/cross-agent-log.py    # NEW — cross-agent observability hook
```

## Files You May Read (for reference patterns)

- `hooks/codex-notify.py` — existing hook implementation style (atomic writes, error handling, logging)
- `design/cross-agent-spec.md` — specification

## Files You May NOT Modify

- `hooks/codex-notify.py`
- `hooks/cc-session-start.sh`
- `hooks/cc-auto-stage.sh`
- `hooks/cc-auto-checkpoint.sh`
- Anything outside `hooks/`

## Validation

After creating the script:
1. `python -m py_compile hooks/cross-agent-log.py` (syntax check)
2. `python hooks/cross-agent-log.py` (no args — should exit silently)
3. `python hooks/cross-agent-log.py '{}'` (empty JSON — should log warning, exit 0)
4. `python hooks/cross-agent-log.py '{"event":"request","call_id":"test123","direction":"cc-to-codex","task_type":"implement","prompt_summary":"Test call","depth":0,"timestamp":"2026-03-02T12:00:00Z","working_dir":"."}'` (should print to stderr)
5. `python hooks/cross-agent-log.py '{"event":"result","call_id":"test123","direction":"cc-to-codex","task_type":"implement","status":"completed","duration_seconds":5.2,"files_changed":[],"timestamp":"2026-03-02T12:00:05Z","depth":0}'` (should update cross-agent-log.json)
6. Verify `state/cross-agent-log.json` exists and has correct structure with summary counters updated
