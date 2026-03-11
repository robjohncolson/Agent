# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## Context

You are the **Agent** — an LLM routing intelligence layer and **cross-machine orchestration hub**. It houses the lesson prep automation pipeline for AP Statistics and manages state across all repos and machines.

### Current State (as of 2026-03-11)

**Completed:**
1. **Task runner integration** — ALL 4 PHASES COMPLETE
2. **Dashboard** — LIVE ON RAILWAY
3. **Schoology-Registry Hardening v1** — COMPLETE (7-step implementation)
4. **Reconciliation v2** — 3 features IMPLEMENTED (AI parsing, folder standardization, orphan repair)
5. **Folder rename execution (Period B)** — 52/52 folders renamed, 0 failures
6. **Period B cleanup** — re-scraped, 4 orphans repaired, 5 cosmetic errors
7. **Period E scrape** — 86 folders, 225 materials, 46 lessons, 0 orphans
8. **Multi-period registry migration** — COMPLETE (Steps 1-7)
   - Registry API: `period` param on `getSchoologyState()`, `setSchoologyState()`, `updateSchoologyMaterial()`
   - Data migration: 43 entries converted from flat `schoology` to `{ B: {...} }`
   - Reconciler, orphan repair, poster, sync, scrape — all period-aware
   - Commits: `f0753a1` (code), `1d94744` (migration), `c87447e` (E renames), `a3c50ca` (E sync)
9. **Period E folder renames** — 41/41 folders renamed to `DayOfWeek M/D/YY` format, 0 failures
10. **Period E tree → registry sync** — 42 lessons synced into `schoology.E`
    - Reconciliation: 0 errors, 0 orphans (was 42 `wrong_folder` errors before migration)
    - Remaining: 36 warnings (missing materials — worksheets/quizzes not posted to E), 44 info (extras)

---

## What to do NOW

### Option A: v5 Realtime (previously deferred)

User indicated low priority earlier but recently expressed interest. Scope TBD — ask user what they want.

### Option B: Period E material gap closure

The reconciler shows 36 `missing_material` warnings for Period E. These are worksheets, quizzes, and drills that exist in the registry URL layer but haven't been posted to Period E's Schoology course. The poster (`post-to-schoology.mjs`) is now period-aware and can post to E via `--course E` (or by passing the E course ID).

### Option C: Registry URL backfill for Period E

The `extra_material` info items (44) indicate Schoology has materials the registry `urls` object doesn't track. Running `sync-tree-to-registry.mjs` populated `schoology.E` folder data, but the `urls` layer still only has B's URLs for worksheets/drills/quizzes. The same URLs work for both periods (they're external links), so this is cosmetic.

---

## Key Architecture

### Schoology Pipeline
- **Deep scraper**: `scripts/schoology-deep-scrape.mjs` — CDP recursive scraper, outputs `state/schoology-tree.json`
- **Reconciler lib**: `scripts/lib/schoology-reconcile.mjs` — pure functions, period-aware (10 issue types)
- **Reconciler CLI**: `scripts/schoology-reconcile.mjs` — human-readable report + `--fix` mode
- **AI classifier**: `scripts/lib/schoology-classify-ai.mjs` — regex first, DeepSeek API fallback, persistent cache
- **Folder standardizer**: `scripts/lib/folder-name-standardizer.mjs` — 12 regex patterns + AI fallback
- **Rename CLI**: `scripts/schoology-rename-folders.mjs` — `--execute` for CDP, `--ai` for DeepSeek
- **Orphan repair**: `scripts/schoology-repair-orphans.mjs` — `--execute` for CDP moves, period-aware
- **Registry API**: `scripts/lib/lesson-registry.mjs` — per-period `schoology[period]`, URL validation
- **DOM helpers**: `scripts/lib/schoology-dom.mjs` — all Schoology CDP interactions, COURSE_IDS
- **Poster**: `scripts/post-to-schoology.mjs` — creates folders + posts links, period-aware
- **Tree sync**: `scripts/sync-tree-to-registry.mjs` — sync lessonIndex → registry `schoology[period]`
- **Migration**: `scripts/migrate-registry-multi-period.mjs` — one-time flat → per-period migration

### Lesson Registry
- `state/lesson-registry.json` — 43 entries
- Per-period `schoology` map: `schoology.B` and `schoology.E` with folder IDs, paths, materials
- `urls.schoologyFolder` (B) and `urls.schoologyFolderE` (E) in URL_KEYS
- Folder URL validation auto-fixes double `?f=` params
- Backup: `state/lesson-registry.pre-multiperiod.json`

### DeepSeek Integration
- API key in `.env` (gitignored): `DEEPSEEK_API_KEY`
- Used for: title parsing (material → unit.lesson), folder name parsing (date extraction)
- Cache: `state/ai-parse-cache.json` (persistent, keyed by title)
- Cost: ~$0.001 per batch call, negligible

### Specs
- `design/multi-period-registry-spec.md` — per-period schoology data (COMPLETE)
- `design/multi-period-dep-graph.md` — implementation dependency graph
- `design/schoology-registry-hardening-spec.md` — original 7-step spec
- `design/reconciliation-v2-spec.md` — AI parsing, orphan repair, folder standardization

---

## Consumer Inventory (10 files, all period-aware)

| # | File | Period-Aware |
|---|------|-------------|
| 1 | `scripts/lib/lesson-registry.mjs` | `period` param on 3 functions + auto-detect |
| 2 | `scripts/post-to-schoology.mjs` | `detectPeriod()` from course ID |
| 3 | `scripts/sync-schoology-to-registry.mjs` | `--course` flag |
| 4 | `scripts/lib/schoology-reconcile.mjs` | `period` param on `reconcileLesson()` + `reconcile()` |
| 5 | `scripts/schoology-reconcile.mjs` | Reads period from tree metadata |
| 6 | `scripts/schoology-repair-orphans.mjs` | Reads period from tree metadata |
| 7 | `scripts/scrape-schoology-urls.mjs` | `--course` flag |
| 8 | `scripts/sync-tree-to-registry.mjs` | Reads period from tree metadata |
| 9 | `scripts/migrate-registry-multi-period.mjs` | One-time migration (done) |
| 10 | `scripts/lesson-prep.mjs` | No change needed (defaults to B) |

---

## Task Queue

1. ~~Lesson prep~~ — DONE
2. ~~Task runner integration~~ — DONE (4 phases)
3. ~~Dashboard go-live~~ — DONE (Railway)
4. ~~Schoology-registry hardening v1~~ — DONE (7 steps)
5. ~~Reconciliation v2~~ — DONE (3 features)
6. ~~Folder rename execution (B)~~ — DONE (52/52)
7. ~~Period B re-scrape + orphan repair~~ — DONE
8. ~~Period E scrape~~ — DONE (86 folders, 225 materials)
9. ~~Multi-period registry migration~~ — DONE (Steps 1-7, all code + data)
10. ~~Period E folder renames~~ — DONE (41/41)
11. ~~Period E tree → registry sync~~ — DONE (42 lessons)
12. v5 Realtime — LOW PRIORITY (user recently expressed interest)

## Key Paths
```
design/multi-period-registry-spec.md       # Migration spec (COMPLETE)
design/multi-period-dep-graph.md           # Dependency graph
scripts/lib/lesson-registry.mjs            # Registry API (period-aware)
scripts/lib/schoology-reconcile.mjs        # Reconciliation library (period-aware)
scripts/schoology-reconcile.mjs            # Reconciliation CLI
scripts/schoology-repair-orphans.mjs       # Orphan repair CLI (period-aware)
scripts/post-to-schoology.mjs             # Schoology poster (period-aware)
scripts/sync-schoology-to-registry.mjs     # Registry sync (--course flag)
scripts/scrape-schoology-urls.mjs          # URL scraper (--course flag)
scripts/sync-tree-to-registry.mjs          # Tree → registry sync (period-aware)
scripts/migrate-registry-multi-period.mjs  # One-time migration (done)
scripts/schoology-deep-scrape.mjs          # CDP recursive scraper
scripts/schoology-rename-folders.mjs       # Folder rename CLI (CDP + AI)
scripts/lib/schoology-classify-ai.mjs      # AI title parser (DeepSeek)
scripts/lib/folder-name-standardizer.mjs   # Folder name normalizer
scripts/lib/schoology-dom.mjs              # CDP DOM helpers + COURSE_IDS
scripts/lib/cdp-connect.mjs               # CDP connector
state/lesson-registry.json                 # Lesson registry (43 entries, B+E)
state/schoology-tree.json                  # Scraped tree (currently Period E)
state/ai-parse-cache.json                  # DeepSeek cache
state/lesson-registry.pre-multiperiod.json # Pre-migration backup
```

## Pipeline Commands
```bash
# Period B (default)
node scripts/lesson-prep.mjs --auto                           # Full auto lesson prep
node scripts/schoology-deep-scrape.mjs --ai                   # Scrape B + AI pass
node scripts/schoology-reconcile.mjs                          # Reconcile (reads period from tree)
node scripts/schoology-rename-folders.mjs --execute --ai      # Rename B folders
node scripts/schoology-repair-orphans.mjs --execute           # Repair B orphans
node scripts/sync-tree-to-registry.mjs --execute              # Sync tree → registry

# Period E
node scripts/schoology-deep-scrape.mjs --course E --ai        # Scrape E
node scripts/schoology-rename-folders.mjs --course E --ai     # Preview E renames
node scripts/schoology-reconcile.mjs                          # Reconcile (reads period from tree)
node scripts/sync-tree-to-registry.mjs --execute              # Sync E tree → registry
```

## Environment
- Platform: Windows 11 Education, no admin (ColsonR)
- Edge CDP on port 9222 for Schoology automation
- Node v22.19.0, Python 3.12
- Codex CLI v0.106.0 (GPT 5.4)
- Schoology course IDs: Period B = `7945275782`, Period E = `7945275798`
- Supabase: `https://hgvnytaqmuybzbotosyj.supabase.co`
- TLS: Corporate proxy requires `NODE_TLS_REJECT_UNAUTHORIZED=0`
