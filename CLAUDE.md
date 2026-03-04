# Agent - LLM Routing Intelligence Layer

Data-gathering repo that profiles LLM characteristics from observed workflows.
Goal: build structured routing knowledge that will eventually automate message dispatch.

## Phase: Data Gathering + Persistent Context

User narrates their multi-LLM workflow. We capture:
- Which LLM was used and why
- Task type (code review, research, brainstorming, debugging, etc.)
- Observed strengths and weaknesses per model
- Context and cost factors (quota, existing context, speed)
- Outcome quality and downstream impact

## Structure

```
profiles/       # One JSON per LLM - accumulated characteristics
observations/   # Timestamped routing decisions + outcomes
state/          # Structured cross-session state (session + per-project)
schema/         # JSON schemas defining data shapes
design/         # Architecture and automation notes
runner/         # Codex automation runners (sequential + parallel)
dispatch/       # Manifest and prompt payloads for multi-agent dispatch
```

## Codex Automation

- Phase 3 sequential runner: `runner/codex-runner.sh`
- Phase 5 parallel runner: `runner/parallel-codex-runner.py`
- Parallel manifest: `dispatch/parallel-batch.manifest.json`
- Parallel state tracking: `state/parallel-batch.json`

## Startup Reconstruction (Phase 4)

When Claude Code starts in this repo:
1. Read `state/session.json` for `current_project`, `active_task`, and checkpoint metadata.
2. Read the `project_state_file` referenced in session state (for example `state/project-grid-bot-v3.json`).
3. Read `CONTINUATION_PROMPT.md` for prose narrative and immediate priorities.
4. Read new observations after `last_synced_observation_id` and the relevant model profiles.

This is additive: structured state files complement `CONTINUATION_PROMPT.md`; they do not replace it.

## Auto-Checkpoint Policy

Before context gets too large (target at 80%, hard stop at 90%):
1. Update `state/session.json` (`active_task`, `last_checkpoint_at`, trigger).
2. Update the active project state file (`commits`, `deployment`, `open_issues`).
3. Refresh `CONTINUATION_PROMPT.md` with the prose narrative delta.
4. Append an observation if new routing behavior or workflow friction was discovered.

## LLM Roster

### Terminal (agentic, file-access)
- `codex` - OpenAI Codex CLI
- `claude-code` - Anthropic Claude Code CLI

### Web UI (conversational, no file-access)
- `deepseek` - DeepSeek chat
- `chatgpt-deep-research` - ChatGPT Deep Research mode
- `gemini` - Google Gemini 3.1 Pro
- `grok` - xAI Grok

## Cross-Agent Delegation (Phase 6)

CC and Codex can invoke each other as subagents mid-task via `runner/cross-agent.py`.

**CC → Codex** (delegate implementation):
```bash
python runner/cross-agent.py \
  --direction cc-to-codex \
  --task-type implement \
  --prompt "Your task description here" \
  --working-dir "C:/Users/rober/Downloads/Projects/Agent" \
  --owned-paths "path/to/file.py" \
  --timeout 120
```

**Codex → CC** (ask a design question):
```bash
python runner/cross-agent.py \
  --direction codex-to-cc \
  --task-type design-question \
  --prompt "Your question here" \
  --working-dir "C:/Users/rober/Downloads/Projects/Agent" \
  --timeout 60
```

**Task types**: `implement`, `review`, `investigate`, `validate`, `design-question`
**Flags**: `--dry-run` (preview prompt, no tokens), `--read-only`, `--owned-paths`
**Spec**: `design/cross-agent-spec.md`
**Logs**: `state/cross-agent-log.json`

When the user asks to delegate work to Codex, use the runner — don't ask the user to copy-paste.
Max recursion depth is 1 (CC→Codex is fine, CC→Codex→CC is blocked).

## Conventions

- All data is JSON
- Profiles are living documents and updated as observations accumulate
- Observations are append-only logs
- State files are checkpoint snapshots and overwritten in place
- Slug IDs are lowercase and hyphenated (example: `chatgpt-deep-research`)
