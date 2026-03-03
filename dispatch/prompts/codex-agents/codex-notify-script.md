# Codex Prompt: Agent B — Codex Notify Script

## Context

You are working in the Agent repo at `C:\Users\rober\Downloads\Projects\Agent`.
This repo tracks LLM routing intelligence and Codex execution progress.

OpenAI Codex CLI has a `notify` config option that calls an external script when `agent-turn-complete` fires. The script receives a single JSON argument with: `type`, `thread-id`, `cwd`, `input-messages`, `last-assistant-message`.

## Task

Create a Python script at `hooks/codex-notify.py` that updates the Agent repo's progress tracking when Codex completes a task.

### Behavior

1. **Parse input**: Read the JSON argument from `sys.argv[1]` (Codex passes it as a CLI argument, not stdin)
2. **Filter**: Only process events where `type` == `"agent-turn-complete"`
3. **Extract phase info**: Search `last-assistant-message` for phase indicators:
   - Regex patterns: `Phase \d+`, `phase-\d+`, `Phase \d+ complete`, etc.
   - Also look in `input-messages` for the original prompt text
4. **Detect project**: Use `cwd` to identify which project Codex was working in
5. **Update progress**:
   - Read `C:\Users\rober\Downloads\Projects\Agent\state\codex-progress.json`
   - Find the matching phase entry (or create one if not found)
   - Update: `status` → `"completed"`, `completed_at` → current UTC timestamp, `thread_id` → from event
   - Write back atomically (write to temp, rename)
6. **Log**: Write a one-line summary to `C:\Users\rober\Downloads\Projects\Agent\state\codex-logs\notify.log` (append mode)

### Edge Cases

- If no phase info found in the message, log it as "untracked task" but still record the event
- If `codex-progress.json` doesn't exist or is empty, create a minimal structure:
  ```json
  {
    "phases": [],
    "last_event_at": "...",
    "untracked_completions": []
  }
  ```
- If the JSON argument is malformed, log the error and exit 0 (never crash — Codex notify must be silent)
- Handle the case where the script is called without arguments (exit 0)

### Requirements

- Python 3 only — no external dependencies (json, sys, os, re, datetime are all stdlib)
- Must be robust — this runs on every Codex task completion, can't crash or block
- Write to stderr for debug logging only
- Exit 0 always
- Use `os.path.join` for paths, handle both Windows backslash and forward slash
- Atomic write: write to `.tmp` file then `os.replace()`

## Files You Create

```
hooks/codex-notify.py     # NEW — Codex notify hook script
```

## Files You May Read (but NOT modify directly — the script modifies at runtime)

- `state/codex-progress.json` (your script will update this at runtime)
- `state/codex-logs/` directory (your script will append to notify.log)

## Files You May NOT Modify

- `~/.codex/config.toml` (wiring is done by CC, not you)
- Anything in `profiles/`, `observations/`

## Validation

After creating the script:
1. `python -m py_compile hooks/codex-notify.py` (syntax check)
2. `python hooks/codex-notify.py` (no args — should exit silently)
3. `python hooks/codex-notify.py '{}'` (empty JSON — should exit silently)
4. `python hooks/codex-notify.py '{"type":"agent-turn-complete","thread-id":"test-123","cwd":"C:/test","input-messages":[],"last-assistant-message":"Phase 3 complete. All tests passing."}'` — should update codex-progress.json
5. Verify `state/codex-logs/notify.log` has an entry
