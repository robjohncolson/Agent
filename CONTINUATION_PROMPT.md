# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## Context

You are the **Agent** — an LLM routing intelligence layer and **cross-machine orchestration hub**. It houses the lesson prep automation pipeline for AP Statistics and manages state across all repos and machines.

### Current State (as of 2026-03-11)

**ACTIVE TASK: Registry Hardening v2 — Implementation**

The lesson registry (`state/lesson-registry.json`) tracks materials posted to Schoology across two course periods (B and E). A session today exposed critical fragility:

- Materials re-posted with new schoologyIds → batch copy times out (30s) looking for deleted DOM elements
- Registry folder IDs point to wrong folders → navigation fails silently
- `updateSchoologyMaterial()` was spreading arrays into objects (`videos` corruption)
- B↔E compliance check depends on fragile `copiedFromId` lineage that breaks on re-post
- No way to detect stale entries without re-scraping

**Fixes already shipped (commit `f23a9d9`):**
- `updateSchoologyMaterial()` — array detection before spread (prevents videos corruption)
- `navigateToFolder()` — JS-based navigation (`window.location.href`) to bypass Schoology SPA redirect
- `sync-tree-to-registry.mjs` — rewritten with `--ids-only` (default) and `--full` modes, proper video array handling
- 5 wrong folder IDs corrected, 14 corrupted video entries fixed, stale IDs refreshed for 6.3/6.4
- Unit 6 Period E fully in sync with Period B

**Spec and dep graph are COMPLETE and ready for implementation:**
- Spec: `design/registry-hardening-spec.md` (916 lines, 3 features, migration plan)
- Dep graph: `design/registry-hardening-dep-graph.md` (5 waves, 10 agents)

---

## What to do NOW

**Implement the registry hardening spec via Codex agent dispatch.**

### Step 1: Read the spec and dep graph
```
design/registry-hardening-spec.md
design/registry-hardening-dep-graph.md
```

### Step 2: Create implementation prompts

Create one prompt file per Codex agent in `dispatch/prompts/registry-hardening/`:

**Wave 1 (3 parallel agents — no dependencies):**
- `step1.1-registry-validator.md` — Create `scripts/lib/registry-validator.mjs`
- `step2.1-content-hash.md` — Create `scripts/lib/content-hash.mjs`
- `step3.4-stale-material-issue.md` — Add `stale_material` issue type to reconciler

**Wave 2 (2 parallel agents):**
- `step1.2-validate-cli.md` — Add `--validate` to `scripts/schoology-reconcile.mjs`
- `step2.2-backfill-hashes.md` — Create `scripts/backfill-content-hashes.mjs`

**Wave 3 (1 agent):**
- `step1.4-wire-validation.md` — Wire validation into `lesson-registry.mjs` write functions

**Wave 4 (2 parallel agents):**
- `step2.4-auto-hash.md` — Auto-compute contentHash in `updateSchoologyMaterial()`
- `step2.5-3.1-sync-tree-hash-liveness.md` — Hash + lastSeenAt/stale in `sync-tree-to-registry.mjs`

**Wave 5 (2 parallel agents):**
- `step2.6-3.3-catchup-diff.md` — Hash-based compliance + staleness in `catch-up-diff.mjs`
- `step2.7-3.2-batch-copy.md` — Hash skip + stale skip in `batch-copy-to-period-e.mjs`

### Step 3: Dispatch agents wave by wave

Use `runner/cross-agent.py` to dispatch Codex agents. Parallel agents within a wave can run simultaneously. Wait for each wave to complete before starting the next.

```bash
# Example: Wave 1 (3 parallel)
python runner/cross-agent.py --direction cc-to-codex --task-type implement \
  --prompt "$(cat dispatch/prompts/registry-hardening/step1.1-registry-validator.md)" \
  --working-dir "C:/Users/ColsonR/Agent" \
  --owned-paths "scripts/lib/registry-validator.mjs" --timeout 120

python runner/cross-agent.py --direction cc-to-codex --task-type implement \
  --prompt "$(cat dispatch/prompts/registry-hardening/step2.1-content-hash.md)" \
  --working-dir "C:/Users/ColsonR/Agent" \
  --owned-paths "scripts/lib/content-hash.mjs" --timeout 120

python runner/cross-agent.py --direction cc-to-codex --task-type implement \
  --prompt "$(cat dispatch/prompts/registry-hardening/step3.4-stale-material-issue.md)" \
  --working-dir "C:/Users/ColsonR/Agent" \
  --owned-paths "scripts/lib/schoology-reconcile.mjs" --timeout 120
```

### Step 4: Manual steps between waves

After Wave 2:
- **Step 1.3**: Run `node scripts/schoology-reconcile.mjs --validate`, fix any violations in the registry

After Wave 3:
- **Step 2.3**: Run `node scripts/backfill-content-hashes.mjs`, spot-check 3 materials

### Step 5: Commit and push after each wave

---

## Key Files Reference

| File | Role |
|------|------|
| `scripts/lib/lesson-registry.mjs` | Registry CRUD — `loadRegistry`, `saveRegistry`, `updateSchoologyMaterial`, `setSchoologyState`, `upsertLesson` |
| `scripts/lib/schoology-dom.mjs` | CDP DOM helpers — `navigateToFolder`, `openGearMenu`, `clickCopyToCourse`, `selectCopyTarget` |
| `scripts/sync-tree-to-registry.mjs` | Syncs scraped tree → registry (IDs-only or full mode) |
| `scripts/batch-copy-to-period-e.mjs` | Batch copies all missing B materials to E |
| `scripts/copy-material-to-course.mjs` | Single-lesson copy via Schoology "Copy to Course" dialog |
| `scripts/lib/catch-up-diff.mjs` | Diffs calendar against registry, builds dependency graph of actions |
| `scripts/lib/catch-up-executors.mjs` | Dispatches actions to pipeline scripts |
| `scripts/schoology-reconcile.mjs` | CLI for registry-tree reconciliation |
| `scripts/lib/schoology-reconcile.mjs` | Pure reconciliation functions |
| `scripts/schoology-deep-scrape.mjs` | CDP recursive scraper → `state/schoology-tree.json` |
| `state/lesson-registry.json` | THE registry — 43 lessons, per-period schoology data |

## Previously Completed

1. Task runner integration (4 phases) — COMPLETE
2. Dashboard — LIVE ON RAILWAY
3. Schoology-Registry Hardening v1 (7 steps) — COMPLETE
4. Reconciliation v2 (AI parsing, folder standardization, orphan repair) — COMPLETE
5. Multi-period registry migration (Steps 1-7) — COMPLETE
6. Period E compliance (unit 6) — COMPLETE
7. LRSL Driller performance optimization (6 commits, 68% bundle reduction) — COMPLETE
8. Catch-up pipeline (5 files) — COMPLETE
9. Copy-to-Course CDP flow — COMPLETE

## Environment

- Platform: Windows 11 Education, no admin (ColsonR)
- Edge CDP on port 9222 for Schoology automation
- Node v22.19.0, Python 3.12
- Codex CLI v0.106.0 (GPT 5.4)
- Schoology course IDs: Period B = `7945275782`, Period E = `7945275798`
- TLS: Corporate proxy requires `NODE_TLS_REJECT_UNAUTHORIZED=0`
- Cross-agent runner: `runner/cross-agent.py`
