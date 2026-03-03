# Codex Prompt: Agent A — CC Hook Scripts

## Context

You are working in the Agent repo at `C:\Users\rober\Downloads\Projects\Agent`.
This repo contains LLM routing intelligence — profiles, observations, and automation tooling.

Claude Code has a hooks system that runs shell scripts on lifecycle events.
The user already has earcon (sound) hooks configured globally.
You are creating **routing intelligence hooks** that will run alongside the earcons.

## Task

Create three bash scripts in `hooks/` (create the directory if it doesn't exist):

### 1. `hooks/cc-session-start.sh`

**Purpose**: Runs on CC SessionStart. Reads routing profiles and state, prints a concise summary to stdout. CC automatically injects stdout into its context.

**Behavior**:
- Read all `profiles/*.json` files — extract `id`, `routing_role` or first strength trait, and confidence
- Read `state/session.json` — extract `current_project`, `active_task`, `last_synced_observation_id`
- Read the project state file referenced in session.json (e.g., `state/project-grid-bot-v3.json`) — extract `status`, deployment info, open issues
- Read the last 3 observations from `observations/log.json` (by highest `id`)
- Print a routing summary to stdout, max 30 lines

**Expected output format**:
```
=== LLM Routing Intelligence (Agent Repo) ===
Roster: CC(hub/8-roles,0.8) | Codex(executor,0.85) | Gemini(visual,0.8) | GPT(systems,0.8) | DeepSeek(math,0.85) | Grok(TBD,0)
Project: grid-bot-v3 | Status: deployed
Task: [active_task from session.json]
Last obs #[N]: [task_summary]
Open issues: [count] ([titles])
Tools: stage-dispatch.ps1 | harvest-responses.ps1 | route-task.ps1 | codex-runner.sh | parallel-codex-runner.py
```

**Requirements**:
- Use `jq` for JSON parsing (available in MINGW/Git Bash on Windows)
- Use `$CLAUDE_PROJECT_DIR` if set, otherwise fall back to the absolute path `C:/Users/rober/Downloads/Projects/Agent`
- Handle missing files gracefully (print "N/A" instead of erroring)
- Script must be executable (`chmod +x`)
- Keep output concise — CC's context is precious, don't dump raw JSON

### 2. `hooks/cc-auto-stage.sh`

**Purpose**: Runs on CC Stop event (async). Detects if CC wrote specialist prompts and auto-stages files.

**Behavior**:
- Read stdin (CC passes JSON with session info including `last_assistant_message` or transcript context)
- Parse the input — look for indicators that specialist prompts were written:
  - References to `dispatch/prompts/` files
  - References to `staging/` directories
  - Keywords like "specialist prompt", "review prompt", "dispatch"
- If dispatch indicators found:
  - Run `powershell -ExecutionPolicy Bypass -File "$AGENT_DIR/scripts/stage-dispatch.ps1"`
  - Log result to stderr: "Auto-staged files for dispatch"
- If no indicators: exit 0 silently

**Requirements**:
- Read all of stdin before processing (CC sends JSON)
- Use `jq` to parse stdin
- The detection should be conservative — only stage if clear indicators are present
- Must handle the case where stdin is empty or malformed
- Print to stderr only (stdout would inject into CC context, which we don't want here)
- Exit 0 always (non-blocking — this is async, shouldn't interrupt CC)

### 3. `hooks/cc-auto-checkpoint.sh`

**Purpose**: Runs on CC PreCompact event. Auto-saves state before context compaction.

**Behavior**:
- Read `state/session.json`
- Update `last_checkpoint_at` to current UTC timestamp
- Read `observations/log.json` to find the highest observation `id`
- Update `last_synced_observation_id` to that value
- Update `checkpoint_trigger` to `"auto-precompact"`
- Write back to `state/session.json`
- Print to stdout: "Context checkpoint saved at [timestamp]. Synced through observation #[N]."

**Requirements**:
- Use `jq` for JSON manipulation
- Use `date -u +%Y-%m-%dT%H:%M:%SZ` for timestamp
- Atomic write: write to temp file, then move (avoid corrupting on partial write)
- Handle missing files gracefully
- Must be executable

## Files You Create

```
hooks/cc-session-start.sh     # NEW — SessionStart hook
hooks/cc-auto-stage.sh        # NEW — Stop hook (async)
hooks/cc-auto-checkpoint.sh   # NEW — PreCompact hook
```

## Files You May NOT Modify

- `~/.claude/settings.json` (global CC config — wiring is done by CC, not you)
- Any file in `profiles/`, `observations/`, `state/` (read-only for these scripts)
- Any file outside the `hooks/` directory

## Validation

After creating the scripts:
1. Run `bash -n hooks/cc-session-start.sh` (syntax check)
2. Run `bash -n hooks/cc-auto-stage.sh` (syntax check)
3. Run `bash -n hooks/cc-auto-checkpoint.sh` (syntax check)
4. Run `bash hooks/cc-session-start.sh` and verify output is ≤30 lines and contains routing summary
5. Run `echo '{}' | bash hooks/cc-auto-stage.sh` and verify it exits silently (no dispatch indicators)
