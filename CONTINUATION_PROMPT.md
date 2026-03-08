# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## Context

You are the **Agent** — an LLM routing intelligence layer that also houses the **lesson prep automation pipeline** for AP Statistics teaching. The pipeline automates the full workflow from calendar lookup to Schoology posting.

### Machines

| Machine | Username | Base path | Notes |
|---------|----------|-----------|-------|
| School | ColsonR | `C:/Users/ColsonR` | Lynn Public Schools, Windows 11 Education |
| Home | rober | `C:/Users/rober/Downloads/Projects/school/` | Personal, Windows + MSYS2 |

Path resolution is handled by `scripts/lib/paths.mjs` — auto-detects machine via `os.userInfo().username`.

### What just happened (2026-03-08)

**Session on home machine (rober).** Completed two major efforts:

#### 1. Machine-aware path configuration (committed + pushed)

Eliminated 33 hardcoded `C:/Users/ColsonR/` paths across 11 scripts. Created `scripts/lib/paths.mjs` which auto-detects the machine and exports all paths. All scripts now import from `paths.mjs`. Commit `90f4203`.

Also installed MiKTeX via scoop and made `MIKTEX_DIR` machine-aware (was hardcoded to school path).

#### 2. Lesson 6.10 pipeline run (committed + pushed to downstream repos)

Ran `node scripts/lesson-prep.mjs --unit 6 --lesson 10` for Monday 3/16 (Period B: Setting Up Test for p₁ − p₂).

**What succeeded:**
- Video ingest via CDP (2 videos from Drive index)
- Worksheet: `u6_lesson10_live.html` — 24 fill-in-the-blank, 2 reflections, exit ticket
- AI grading prompts: `ai-grading-prompts-u6-l10.js`
- Drills cartridge: 4 new modes (l17-l20) for hypotheses, procedure, pooled proportion, conditions
- Blooket CSV: 30 questions generated, manually uploaded after fixing CSV format
- Schoology: all 4 links posted (worksheet, drills, quiz, blooket)
- Both downstream repos committed and pushed

**What went wrong (lessons learned):**
- Playwright wasn't installed on home machine (fixed: `npm install playwright`)
- MiKTeX wasn't installed (fixed: `scoop install miktex`)
- Blooket CSV had commas inside math notation answers — broke Blooket's parser. Fixed by replacing commas with semicolons. Also had trailing blank line and UTF-8 BOM.
- Blooket upload script (`upload-blooket.mjs`) failed repeatedly — spent time chasing "Spreadsheet Import" UI changes when the real problem was CSV formatting
- Schoology posting initially failed (not signed in), then succeeded on retry
- Schoology folder wasn't created because we ran `post-to-schoology.mjs` directly instead of through `lesson-prep.mjs --auto`
- Multiple empty Blooket sets created from failed retries (need cleanup)
- Blooket URL had to be manually found and passed between scripts

### New spec: URL Registry + CSV Validation

**Read: `design/url-registry-and-csv-validation-spec.md`**

Five improvements designed but not yet implemented:

1. **CSV validation** — validate Blooket CSV immediately after generation. Check field counts, no commas in answer text, no non-ASCII, proper header. Auto-fix where possible.
2. **URL registry** (`state/lesson-registry.json`) — persistent JSON mapping unit.lesson → all URLs + status. Enables pipeline resumability, cross-script URL sharing, and calendar app integration.
3. **Preflight check** (`scripts/preflight.mjs`) — verify all dependencies and browser sessions before running pipeline on a new machine.
4. **Schoology scraper** — backfill registry with URLs from previously posted lessons by walking Schoology course materials.
5. **Blooket upload fix** — update selectors in `upload-blooket.mjs` for current Blooket UI.

**Implementation order:** CSV validation → URL registry → preflight → scraper → Blooket fix.

### Files modified/created this session

**Agent repo:**
- `scripts/lib/paths.mjs` — NEW: machine-aware path config
- `scripts/verify-paths.mjs` — NEW: path validation
- `scripts/upload-blooket.mjs` — added modal dismissal (partially working)
- `scripts/watch-blooket.mjs` — NEW: temporary debug watcher (can delete)
- All 11 consumer scripts — import from paths.mjs instead of hardcoding
- `design/url-registry-and-csv-validation-spec.md` — NEW: improvement spec

**Downstream repos (committed + pushed):**
- `follow-alongs/u6_lesson10_live.html` — worksheet
- `follow-alongs/ai-grading-prompts-u6-l10.js` — AI grading
- `follow-alongs/u6_l10_blooket.csv` — Blooket CSV (fixed)
- `lrsl-driller/cartridges/apstats-u6-inference-prop/` — manifest, generator, grading-rules updated with 6.10 modes (merged with upstream 6.4-6.9 content)

### Repos

| Repo | School path | Home path | Description |
|------|------------|-----------|-------------|
| **apstats-live-worksheet** | `C:/Users/ColsonR/apstats-live-worksheet` | `.../school/follow-alongs` | Worksheets, calendar, Blooket CSVs |
| **curriculum-render** | `C:/Users/ColsonR/curriculum_render` | `.../school/curriculum_render` | Quiz app + `data/units.js` |
| **lrsl-driller** | `C:/Users/ColsonR/lrsl-driller` | `.../school/lrsl-driller` | Drill platform + cartridges |
| **Agent** | `C:/Users/ColsonR/Agent` | `C:/Users/rober/Downloads/Projects/Agent` | Pipeline orchestrator |

### Pipeline command reference

```bash
# Full auto (detects tomorrow's lesson):
node scripts/lesson-prep.mjs --auto

# Prep for a specific date:
node scripts/lesson-prep.mjs --auto --date 2026-03-16

# Manual unit/lesson:
node scripts/lesson-prep.mjs --unit 6 --lesson 10

# Schoology posting with blooket URL:
node scripts/post-to-schoology.mjs --unit 6 --lesson 10 --auto-urls \
  --blooket "URL" --create-folder "Monday 3/16/26"

# Verify paths on current machine:
node scripts/verify-paths.mjs
```

### Key architectural decisions
- Schoology/Blooket/AI Studio automation uses Playwright CDP connecting to Edge on port 9222
- `scripts/lib/paths.mjs` auto-detects machine via username, exports all paths
- Step 2 uses `codex exec --full-auto` with stdin piping
- Prompts embed ALL context inline — video transcriptions + pattern files
- Pipeline gating: Step 1 failure → abort; Step 2 failure → abort; Steps 3-5 non-blocking

I am a high school math teacher building educational tools. My main projects are AP Statistics teaching tools. I want the lesson prep workflow to be as automated as possible — ideally I say "prep for Monday" and everything happens.
