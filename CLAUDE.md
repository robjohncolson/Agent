# Agent - LLM Routing Intelligence Layer

Data-gathering repo that profiles LLM characteristics from observed workflows.
Goal: build structured routing knowledge that will eventually automate message dispatch.

## Wiki Knowledge Base

Path: `C:/Users/rober/Downloads/Projects/obsidian-wiki`. This project is heavily covered — design docs, roadmap, routing observations, fan-out patterns all live there.

**Always read `wiki/hot.md` first** (≤800 words, includes a routing table). If user mentions any of: animations/upload-animations, Agent Hub v1/v2/v4, Blooket CDP, Lesson Prep / Catch-Up, Cross-Agent, DeepSeek validation, Disable Game Modes, routing observations, or fan-out review — the relevant wiki page is named in the `hot.md` routing table. Drill into `wiki/index.md` only if the routing table misses.

Do NOT read the wiki for general coding questions or things already in this repo's files.

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Agent** (3513 symbols, 4236 relationships, 93 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/Agent/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Agent/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Agent/clusters` | All functional areas |
| `gitnexus://repo/Agent/processes` | All execution flows |
| `gitnexus://repo/Agent/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## Code Style

Write extremely easy to consume code. Optimize for how easy the code is to read. Make the code skimmable. Avoid cleverness. Use early returns.
