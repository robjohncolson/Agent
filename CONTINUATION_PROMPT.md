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

### What just happened (2026-03-08, evening session)

#### TUI Menu System (committed + pushed)
Built `scripts/menu.mjs` — a terminal UI for the lesson-prep pipeline. `npm start` shows an arrow-key menu with 8 options: prep next undeveloped, prep tomorrow, prep specific, view status, get URLs, preflight, utility tools, quit. Uses `prompts` npm package.

Also built `scripts/lib/scan-calendars.mjs` — parses all `*_calendar.html` files in CALENDAR_DIR, extracts Period B lessons, returns sorted/deduped array. Found 33 lessons (5.4 through 9.5).

#### Lesson 6.11 Pipeline Run (partially successful)
Ran "Prep next undeveloped" → selected 6.11. Results:
- **Succeeded:** Video ingest, worksheet, grading prompts, Blooket CSV, drills cartridge, lesson URLs, downstream commits (not pushed)
- **Failed:** Blooket upload (`"Could not find 'Spreadsheet Import' button"`), Schoology posting (`ETIMEDOUT` on stdin prompt)

#### Blooket/Schoology Fix (committed + pushed)
Three fixes deployed via parallel Codex agents:
1. `upload-blooket.mjs` — replaced 5 single-selector lookups with multi-strategy cascades (4-6 selectors each) + `dumpPageState()` debug dump on failure
2. `post-to-schoology.mjs` — added `--no-prompt` flag + `process.stdin.isTTY` check to skip blocking readline, added registry check to skip re-attempting failed Blooket uploads
3. `lesson-prep.mjs` — passes `--no-prompt` to Step 6 Schoology invocation

**BUT: The selector fixes are still speculative.** Nobody has inspected the actual current Blooket/Schoology/AI Studio DOM. The debug dump will help on next failure, but the real fix requires a live inspection session.

---

## NEXT TASK: Interactive CDP Resilience Session

The user wants a **hands-on session** where we connect to the debug browser and inspect each service's actual DOM together. The goal is to make all three CDP automations bulletproof.

### The 3 Services to Fix

#### 1. Blooket (dashboard.blooket.com)
- **Script:** `scripts/upload-blooket.mjs`
- **Flow:** Navigate to `/create` → select "CSV Upload" radio → fill title → click "Create Set" → redirect to `/edit?id=xxx` → click "Spreadsheet Import" → upload CSV file → click "Import" → click "Save Set"
- **Known broken:** "Spreadsheet Import" button selector fails. All other selectors are suspect too.
- **Key:** The `findButton()` helper and `dumpPageState()` were just added — use `dumpPageState` output to find real selectors.

#### 2. Schoology (lynnschools.schoology.com)
- **Script:** `scripts/post-to-schoology.mjs`
- **Flow:** Navigate to course materials → optionally create folder → post links as external URL materials
- **Status:** The `--no-prompt` fix prevents the stdin crash, but actual Schoology selectors haven't been audited.

#### 3. AI Studio (aistudio.google.com)
- **Script:** `scripts/aistudio-ingest.mjs`
- **Flow:** Upload Drive video files for context extraction
- **Status:** Unknown — hasn't been tested against live UI recently.

### How to Run the Session

1. **Start Edge debug mode:**
   ```bash
   scripts/start-edge-debug.cmd
   # Or manually: msedge --remote-debugging-port=9222 --user-data-dir="C:\Users\rober\.edge-debug-profile"
   ```

2. **Inspect a page's DOM:**
   ```bash
   node -e "
     import('playwright').then(async pw => {
       const b = await pw.chromium.connectOverCDP('http://localhost:9222');
       const pages = b.contexts()[0].pages();
       console.log('Open pages:', pages.map(p => p.url()));
       // Find blooket/schoology/aistudio tab and dump its DOM
       const page = pages.find(p => p.url().includes('blooket'));
       if (page) {
         const info = await page.evaluate(() => ({
           url: location.href,
           buttons: [...document.querySelectorAll('button, [role=button], div[class*=button]')]
             .slice(0,20).map(e => ({ tag: e.tagName, text: e.innerText.trim().slice(0,80), cls: e.className.slice(0,100) }))
         }));
         console.log(JSON.stringify(info, null, 2));
       }
       await b.close();
     });
   "
   ```

3. **For each service:** Navigate, log in if needed (user provides credentials), dump DOM at each step, update selectors, test full flow.

4. **Test end-to-end:** Run the actual upload/posting scripts and verify they complete.

### Key Resilience Patterns to Add

- **Login detection:** Before starting any flow, check if logged in. If not, navigate to login page and wait for user to authenticate.
- **Wait strategies:** Replace `waitForTimeout` with `waitForSelector` where possible. Add retry loops for flaky loads.
- **Screenshot on failure:** Save a screenshot to `state/debug/` when a step fails.
- **Selector registry:** Consider a `scripts/lib/selectors.json` mapping logical names to CSS selectors, so they can be updated without editing code.

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/upload-blooket.mjs` | Blooket CSV upload (414→~500 lines) |
| `scripts/post-to-schoology.mjs` | Schoology link posting |
| `scripts/aistudio-ingest.mjs` | AI Studio video context extraction |
| `scripts/lesson-prep.mjs` | 10-step pipeline orchestrator |
| `scripts/menu.mjs` | TUI menu (365 lines) |
| `scripts/lib/cdp-connect.mjs` | CDP connection helper |
| `scripts/lib/paths.mjs` | Machine-aware path config |
| `scripts/lib/lesson-registry.mjs` | Lesson status/URL CRUD |
| `scripts/lib/scan-calendars.mjs` | Calendar HTML parser |
| `scripts/start-edge-debug.cmd` | Launch Edge with debug port |
| `scripts/watch-blooket.mjs` | Temp watcher for page state |
| `design/blooket-upload-fix-spec.md` | Spec for selector fixes |

## Repos

| Repo | Home path | Description |
|------|-----------|-------------|
| **Agent** | `C:/Users/rober/Downloads/Projects/Agent` | Pipeline orchestrator |
| **apstats-live-worksheet** | `.../school/follow-alongs` | Worksheets, calendar, Blooket CSVs |
| **curriculum-render** | `.../school/curriculum_render` | Quiz app + units.js |
| **lrsl-driller** | `.../school/lrsl-driller` | Drill platform + cartridges |

## Pipeline Commands

```bash
npm start                                    # TUI menu
node scripts/lesson-prep.mjs --auto          # Full auto (tomorrow)
node scripts/lesson-prep.mjs --unit 6 --lesson 11 --skip-ingest --force
node scripts/upload-blooket.mjs --unit 6 --lesson 11 --force
node scripts/post-to-schoology.mjs --unit 6 --lesson 11 --auto-urls --no-prompt
node scripts/preflight.mjs                   # Check all deps
node scripts/verify-paths.mjs                # Check path config
```

## Unfinished Business

- 6.11 downstream repos committed locally but NOT pushed (apstats-live-worksheet, lrsl-driller)
- Blooket set for 6.11 was created but CSV import failed — may have an empty set on Blooket that needs cleanup
- 32 more lessons (5.4–9.5 minus 6.10 and 6.11) remain undeveloped

I am a high school math teacher building educational tools. My main projects are AP Statistics teaching tools. I want the lesson prep workflow to be as automated as possible — ideally I say "prep for Monday" and everything happens.
