# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## Context

You are the **Agent** — an LLM routing intelligence layer and **cross-machine orchestration hub**. It houses the lesson prep automation pipeline for AP Statistics and manages state across all repos and machines.

### Current State (as of 2026-03-10)

**Completed this session:**
1. **Task runner integration** — ALL 4 PHASES COMPLETE
   - Phase 1 (`1b7b005`): Registry enforcement, pipeline context, CLI entry point
   - Phase 2 (`2d9d818`): Content-gen worker + codex launcher extraction
   - Phase 3 (`436eefd`): `--task-runner` mode in lesson-prep.mjs, commit-push worker
   - Phase 4 (`33a214b`): Default mode, async spawn parallelism, skip support
   - `lesson-prep.mjs --auto` now uses the declarative task runner by default (`--legacy` for old path)

2. **Dashboard go-live** — DEPLOYED ON RAILWAY
   - Commit `71eeb6c`: Dockerfile ARG-based env var injection
   - Commit `982b80c`: Error display fixes, diagnostic banner
   - RLS policies created on `agent_events` and `agent_checkpoints`
   - Dashboard is live at Railway, serving from `dashboard/` root directory

---

## Active Task: Schoology-Registry Hardening

**Problem**: The lesson registry drifts from Schoology reality. Links get posted to wrong folders, folder URLs get malformed, and three redundant Schoology representations compete.

**Spec**: `design/schoology-registry-hardening-spec.md` (COMPLETE)
**Dependency graph**: `design/schoology-hardening-dep-graph.md` (COMPLETE)
**Implementation prompts**: `dispatch/prompts/schoology-hardening/step{1-7}-*.md` (COMPLETE)

### What to do NOW

1. Read the spec: `design/schoology-registry-hardening-spec.md`
2. Read the dep graph: `design/schoology-hardening-dep-graph.md`
3. Implement in dependency order, using Codex agents in parallel where the graph allows:

**Wave 1 (parallel):**
- Step 1: `dispatch/prompts/schoology-hardening/step1-classify-extract.md`
- Step 3: `dispatch/prompts/schoology-hardening/step3-registry-migration.md`

**Wave 2 (parallel, after Wave 1):**
- Step 2: `dispatch/prompts/schoology-hardening/step2-deep-scraper.md`
- Step 4: `dispatch/prompts/schoology-hardening/step4-registry-api.md`

**Wave 3 (after Wave 2):**
- Step 5: `dispatch/prompts/schoology-hardening/step5-reconcile-lib.md`

**Wave 4 (after Wave 3):**
- Step 6: `dispatch/prompts/schoology-hardening/step6-reconcile-cli.md`

**Wave 5 (after Wave 4):**
- Step 7: `dispatch/prompts/schoology-hardening/step7-pipeline-integration.md`

4. After each wave completes: commit and push with descriptive message
5. After all waves: run `node scripts/schoology-reconcile.mjs --unit 6 --lesson 4` to verify the known 6.4 issue is detected

### Codex Delegation

Use `runner/cross-agent.py` for Codex delegation:
```bash
python runner/cross-agent.py \
  --direction cc-to-codex \
  --task-type implement \
  --prompt "$(cat dispatch/prompts/schoology-hardening/step1-classify-extract.md)" \
  --working-dir "C:/Users/ColsonR/Agent" \
  --owned-paths "scripts/lib/schoology-classify.mjs" "scripts/sync-schoology-to-registry.mjs" \
  --timeout 120
```

Or use Claude Code Agent tool with `subagent_type: "general-purpose"` for implementation.

---

## Task Queue

1. ~~Lesson prep~~ — DONE
2. ~~Task runner integration~~ — DONE (4 phases)
3. ~~Dashboard go-live~~ — DONE (Railway)
4. **Schoology-registry hardening** — IN PROGRESS (spec + prompts done, implementation next)
5. v5 Realtime — DEFERRED (user says low priority)

## Key Files

```
design/schoology-registry-hardening-spec.md   # Full spec (this task)
design/schoology-hardening-dep-graph.md        # Dependency graph
dispatch/prompts/schoology-hardening/          # 7 implementation prompts
scripts/lib/task-runner.mjs                    # Pipeline engine
scripts/run-pipeline.mjs                       # CLI entry point
pipelines/lesson-prep.json                     # Pipeline definition (12 steps)
scripts/lib/lesson-registry.mjs               # Registry API
scripts/lesson-prep.mjs                        # Orchestrator (uses task runner by default)
scripts/post-to-schoology.mjs                  # Schoology posting (to be modified in step 7)
scripts/lib/schoology-dom.mjs                  # Shared DOM helpers
scripts/lib/schoology-heal.mjs                 # Folder auditing
scripts/scrape-schoology.mjs                   # Existing scraper (to be superseded)
scripts/sync-schoology-to-registry.mjs         # Sync logic (step 1 extracts from this)
dashboard/                                     # Live on Railway
```

## Pipeline Commands
```bash
npm start                                              # Startup check + TUI menu
node scripts/lesson-prep.mjs --auto                    # Full auto (task runner default)
node scripts/lesson-prep.mjs --auto --legacy           # Old inline orchestration
node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5 --dry-run
node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5 --skip-step ingest
```

## Supabase State
- `agent_checkpoints` — LIVE
- `agent_events` — LIVE
- Dashboard: LIVE on Railway (RLS read policies active)
- URL: `https://hgvnytaqmuybzbotosyj.supabase.co`
- Credentials: `.env` (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY)
- TLS: Corporate proxy requires `NODE_TLS_REJECT_UNAUTHORIZED=0`

## User Profile
- High school AP Statistics teacher at Lynn Public Schools
- Work machine: ColsonR, Windows 11 Education, no admin
- Wants maximum automation — "prep for Monday" should be one command
- Uses Edge browser with CDP (port 9222) for Schoology/Blooket/AI Studio
- Codex CLI v0.106.0, GPT-5.4, invoked via `codex exec --full-auto`
- Railway deployment is the end goal for all features
