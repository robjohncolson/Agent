# Spec: Native Hook Integration — Routing Intelligence in CC and Codex

## Problem

The automation framework (7 phases) exists as static scripts the user runs manually.
The routing intelligence (profiles, observations, state) sits in files CC doesn't automatically read.
The result: CC starts every session blank. Codex doesn't report progress. The human is still the relay.

## Goal

Wire the Agent repo's routing intelligence directly into CC's hooks and Codex's config so that:
1. CC **starts every session already knowing** the routing profiles and current project state
2. CC **auto-stages files** for web UI dispatch when writing specialist prompts
3. CC **auto-checkpoints** state before context compaction
4. Codex **reports progress** on task completion via notify hook
5. Codex **reads routing-aware instructions** via AGENTS.md and skills

## Existing Hook Infrastructure

CC global settings (`~/.claude/settings.json`) already has earcon hooks on 6 events:
- SessionStart, UserPromptSubmit, PostToolUse, PostToolUseFailure, Notification, Stop
- All call `python C:\Users\rober\.claude\sounds\play_earcon.py <event>`
- New routing hooks **must coexist** with earcons (multiple hooks per event are supported)

Codex config (`~/.codex/config.toml`) has:
- model = "gpt-5.3-codex", reasoning_effort = "xhigh"
- No `notify` hook configured yet
- No AGENTS.md in grid-bot-v3

## Architecture

### CC Hooks (add to global settings.json alongside earcons)

**1. SessionStart → `hooks/cc-session-start.sh`**
- Reads `profiles/*.json` — extracts each LLM's role, confidence, best_for
- Reads `state/session.json` — current project, active task, last observation ID
- Reads `state/project-*.json` for the current project — deployment status, open issues
- Reads last 5 observations from `observations/log.json`
- Prints a concise routing summary to stdout → injected into CC's context
- Output format: ~30 lines max (roles table + current state + recent observations)
- Uses `$CLAUDE_PROJECT_DIR` if in Agent repo, else reads from absolute path

**2. Stop → `hooks/cc-auto-stage.sh`** (async: true)
- Receives CC's last response via stdin JSON
- Scans for specialist prompt indicators (file paths matching `dispatch/prompts/*.md`)
- If detected: runs `stage-dispatch.ps1` automatically
- Logs staging result to stderr (non-blocking)
- Only fires when CC has actually written specialist prompts, not on every stop

**3. PreCompact → `hooks/cc-auto-checkpoint.sh`**
- Fires before context compaction (CC's way of handling context window pressure)
- Writes current state to `state/session.json` with updated timestamp and observation ID
- Prints reminder to stdout: "Context checkpoint saved. State persisted to Agent repo."
- This replaces the manual "please write a continuation prompt" pattern

### Codex Integration

**4. Notify hook → `hooks/codex-notify.py`**
- Configured via `notify` in `~/.codex/config.toml`
- Receives JSON with `type`, `thread-id`, `cwd`, `last-assistant-message`
- On `agent-turn-complete`: updates `state/codex-progress.json` with phase status, timestamp
- Detects phase number from the prompt/message context
- Writes to a known location so CC can poll completion

**5. AGENTS.md in grid-bot-v3**
- Routing-aware project instructions for Codex
- Tells Codex: which files it owns, what it may NOT touch, how to report results
- References the Agent repo's data contracts and file ownership patterns
- CC updates this dynamically before dispatching phases

**6. Codex Skills (in grid-bot-v3/.agents/skills/)**
- `phase-report/SKILL.md` — after completing work, Codex writes a structured phase report
- `auto-commit/SKILL.md` — commit with descriptive message following project conventions

## File Ownership (for parallel Codex execution)

| Agent | Files Created | Files Modified |
|-------|--------------|----------------|
| A: CC Hook Scripts | `hooks/cc-session-start.sh`, `hooks/cc-auto-stage.sh`, `hooks/cc-auto-checkpoint.sh` | — |
| B: Codex Notify | `hooks/codex-notify.py` | — |
| C: Grid-bot AGENTS.md + Skills | grid-bot-v3: `AGENTS.md`, `.agents/skills/phase-report/SKILL.md`, `.agents/skills/auto-commit/SKILL.md` | — |
| D: Wiring (CC does this, not Codex) | — | `~/.claude/settings.json`, `~/.codex/config.toml` |

## Dependency Graph

```
Batch 1 (all parallel — zero file overlap):

  Agent A: CC hook scripts ────┐
  Agent B: Codex notify ───────┼── all independent
  Agent C: AGENTS.md + skills ─┘
           │
           ▼ CC reviews all three
           │
  Agent D: Wiring (CC wires hooks into settings.json + config.toml)
```

Agents A, B, C can run simultaneously. Agent D is done by CC after reviewing A+B+C output.

## Hook Script Details

### cc-session-start.sh (stdout → injected into CC context)

Expected output (~30 lines):
```
=== LLM Routing Intelligence ===
Profiles: CC(hub,0.85) Codex(executor,0.85) Gemini(visual,0.8) GPT(systems,0.8) DeepSeek(math,0.85) Grok(TBD,0)
Project: grid-bot-v3 | Status: deployed | 3-process stack on Railway
Active: Automation framework complete. Ready for first live dispatch cycle.
Last obs: #40 — All 7 automation phases implemented by Codex
Open issues: Kraken funding, health endpoint
Dispatch: stage-dispatch.ps1 | Harvest: harvest-responses.ps1 | Route: route-task.ps1
Sequential runner: codex-runner.sh | Parallel runner: parallel-codex-runner.py
```

### cc-auto-stage.sh (async, fires on Stop)

Logic:
1. Parse stdin JSON for `last_assistant_message`
2. Check if message references specialist prompts or dispatch
3. If yes: `powershell -ExecutionPolicy Bypass -File scripts/stage-dispatch.ps1`
4. If no: exit 0 silently

### cc-auto-checkpoint.sh (fires on PreCompact)

Logic:
1. Read current `state/session.json`
2. Update `last_checkpoint_at` to now
3. Update `last_synced_observation_id` to latest in `observations/log.json`
4. Write back
5. Print confirmation to stdout

### codex-notify.py

Logic:
1. Parse JSON argument for `type`, `cwd`, `last-assistant-message`
2. If `type` == `agent-turn-complete`:
   - Extract phase info from message (regex for "Phase N" or similar)
   - Update `state/codex-progress.json` with status, timestamp, thread-id
3. Exit

## Wiring (CC does after review)

Add to `~/.claude/settings.json` alongside existing earcon hooks:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "python C:\\Users\\rober\\.claude\\sounds\\play_earcon.py begin", "timeout": 6 }] },
      { "hooks": [{ "type": "command", "command": "bash C:\\Users\\rober\\Downloads\\Projects\\Agent\\hooks\\cc-session-start.sh", "timeout": 10 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "python C:\\Users\\rober\\.claude\\sounds\\play_earcon.py end", "timeout": 5 }] },
      { "hooks": [{ "type": "command", "command": "bash C:\\Users\\rober\\Downloads\\Projects\\Agent\\hooks\\cc-auto-stage.sh", "timeout": 30, "async": true }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "command", "command": "bash C:\\Users\\rober\\Downloads\\Projects\\Agent\\hooks\\cc-auto-checkpoint.sh", "timeout": 10 }] }
    ]
  }
}
```

Add to `~/.codex/config.toml`:
```toml
notify = ["python3", "C:\\Users\\rober\\Downloads\\Projects\\Agent\\hooks\\codex-notify.py"]
```

## Evidence

- obs #31: copy-paste friction → auto-staging solves dispatch side
- obs #37: context window management → PreCompact hook solves checkpoint side
- obs #40: automation framework exists but is static → hooks make it dynamic
- Existing earcon hooks prove the hook system works in this environment
