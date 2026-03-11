# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## Context

You are the **Agent** — an LLM routing intelligence layer and **cross-machine orchestration hub**. It houses the lesson prep automation pipeline for AP Statistics and manages state across all repos and machines.

### Current State (as of 2026-03-10)

**Task runner integration — Phase 1 complete (uncommitted):**

1. **`task-runner.mjs` enhanced** with:
   - Registry-based precondition enforcement (`checkRegistryPrecondition()`) — skips tasks when registry status = "done"
   - Pipeline context (`Map`) for inter-step data flow — merges from registry after each step
   - Force/forceSteps override support for preconditions
   - Registry status auto-update after step completion/failure via `updateStatus()`
   - `codex-agent` task type implementation (spawns Codex CLI via `spawn()`)
   - `topoSort()` dead code cleaned up
   - Template resolution reads from both `params` and pipeline `context`

2. **`lesson-registry.mjs` STATUS_KEYS expanded** — added: `animationUpload`, `schoologyVerified`, `urlsGenerated`, `registryExported`, `committed`

3. **Task definition registry keys fixed** — snake_case → camelCase to match actual STATUS_KEYS:
   - `content-gen-blooket.json`: `blooket_csv` → `blooketCsv`
   - `upload-blooket.json`: `blooket_url` → `blooketUpload`
   - `upload-animations.json`: `animation_urls` → `animationUpload`
   - `verify-schoology.json`: `schoology_verified` → `schoologyVerified`
   - `generate-urls.json`: `urls_generated` → `urlsGenerated`
   - `export-registry.json`: `registry_exported` → `registryExported`

4. **`scripts/run-pipeline.mjs` created** — CLI entry point for the task runner:
   ```bash
   node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5 --dry-run
   node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5 --force
   node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5 --force-step ingest
   ```

5. **`design/task-runner-integration-spec.md` created** — full gap analysis and 4-phase plan

**Dry run verified** — topological sort produces 7 correct waves with parallel execution.
**Precondition skips verified** — lesson 6.4 (fully done) correctly skips 6/12 steps.

**Prior session commits (already pushed):**
- `3a085e6` — Step 2 selective resume fix
- `fd6ead5` — Schoology folder path navigation

---

## Task Queue (user's priority order)

1. ~~Lesson prep~~ — **DONE** (6.4 complete)
2. **Task runner integration** — IN PROGRESS
   - Phase 1: DONE (this session — registry enforcement, context, codex-agent type, CLI entry)
   - Phase 2: NEXT — Extract Step 2 content gen into `scripts/workers/codex-content-gen.mjs`
   - Phase 3: Wire `lesson-prep.mjs` main() to call `runPipeline()` instead of inline orchestration
   - Phase 4: Deprecate inline orchestration, lesson-prep.mjs becomes thin wrapper
   - Spec: `design/task-runner-integration-spec.md`
3. **Dashboard go-live** — after task runner
4. **v5 Realtime** — after dashboard

### Roadmap (from `design/agent-hub-roadmap.md`)
- v3: Auto-discovery & repo indexing
- v4: Dashboard — scaffolded, needs go-live
- v5: Realtime cross-machine awareness
- v6: Full automation ratchet
- Railway deployment — end goal for all features

User explicitly said: **"all things should be constructed with the headless Railway deployment as the end goal."**

---

## Key Files

```
scripts/lib/task-runner.mjs    # Pipeline engine (enhanced this session)
scripts/run-pipeline.mjs       # CLI entry point (new this session)
pipelines/lesson-prep.json     # Pipeline definition (12 steps)
tasks/*.json                   # 12 task definitions (registry keys fixed this session)
scripts/lib/lesson-registry.mjs  # Registry (STATUS_KEYS expanded this session)
scripts/lesson-prep.mjs        # Current inline orchestration (~2100 lines)
design/task-runner-integration-spec.md  # Integration spec (new this session)
```

## Pipeline Commands
```bash
npm start                                              # Startup check + TUI menu
node scripts/lesson-prep.mjs --auto                    # Full auto (tomorrow's lesson)
node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5 --dry-run  # Task runner dry run
node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5            # Task runner live
node scripts/post-to-schoology.mjs -u 6 -l 4 --folder-path "Q3/week 24" --auto-urls --no-prompt
```

## Supabase State
- `agent_checkpoints` — LIVE
- `agent_events` — LIVE
- URL: `https://hgvnytaqmuybzbotosyj.supabase.co`
- Credentials: `.env` (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
- TLS: Corporate proxy requires `NODE_TLS_REJECT_UNAUTHORIZED=0`
- **Dashboard needs**: anon key + RLS SELECT policies on both tables

## User Profile
- High school AP Statistics teacher at Lynn Public Schools
- Work machine: ColsonR, Windows 11 Education, no admin
- Wants maximum automation — "prep for Monday" should be one command
- Uses Edge browser with CDP (port 9222) for Schoology/Blooket/AI Studio
- Codex CLI v0.106.0, GPT-5.4, invoked via `codex exec --full-auto`
- Has a home machine (rober) — cross-machine sync is why Agent Hub exists
