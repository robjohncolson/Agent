# URL Registry + CSV Validation + Pipeline Reliability Spec

## Problem Statement

The lesson-prep pipeline generates URLs across multiple steps (worksheet, drills, quiz, Blooket, Schoology folder) but passes them ephemerally via CLI flags. When a step fails mid-pipeline:
- URLs from earlier steps are lost
- Re-running creates duplicates (e.g., 5 empty Blooket sets from retries)
- No way to resume from where it failed
- Cross-script communication requires manual copy-paste of URLs

Additionally, the Blooket CSV generation step produces files with commas inside answer text that break Blooket's CSV parser, but validation only happens after upload fails.

## Part 1: URL Registry (`state/lesson-registry.json`)

### Shape

```json
{
  "6.10": {
    "unit": 6,
    "lesson": 10,
    "topic": "Setting Up Test for p1 - p2",
    "date": "2026-03-16",
    "period": "B",
    "urls": {
      "worksheet": "https://robjohncolson.github.io/apstats-live-worksheet/u6_lesson10_live.html",
      "drills": "https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l17-hypotheses-610",
      "quiz": "https://robjohncolson.github.io/curriculum_render/?u=6&l=9",
      "blooket": "https://dashboard.blooket.com/set/69ad1cce0d5874349dbbf688",
      "schoologyFolder": null,
      "videos": ["1dIRMyHdePpkx7pCJFcAkRHIPj2Q8RtqG", "1SDYELDZa9kcJldq_qf1DsOOMhrjzfkio"]
    },
    "status": {
      "ingest": "done",
      "worksheet": "published",
      "drills": "published",
      "blooketCsv": "generated",
      "blooketUpload": "done",
      "animations": "skipped",
      "schoology": "posted"
    },
    "timestamps": {
      "created": "2026-03-08T01:00:00Z",
      "lastUpdated": "2026-03-08T02:15:00Z"
    }
  }
}
```

### Key design decisions

- **Key format**: `"6.10"` (unit.lesson) — simple, human-readable, matches existing naming
- **Single file**: JSON, checked into git, shared across machines
- **URLs are deterministic where possible**: worksheet, drills, quiz URLs can be computed from unit/lesson without any pipeline run. Only Blooket and Schoology folder URLs are truly dynamic.
- **Status per step**: enables resuming — skip steps already marked "done"

### How scripts use it

1. **lesson-prep.mjs** (orchestrator):
   - At start: load registry, check what's already done for this unit/lesson
   - After each step: write the URL + status back to registry
   - On resume: skip steps where `status === "done"` and `urls.X` exists

2. **post-to-schoology.mjs**:
   - Reads Blooket URL from registry instead of requiring `--blooket` flag
   - Writes Schoology folder URL back to registry after creation

3. **upload-blooket.mjs**:
   - Writes Blooket set URL back to registry on success
   - On retry: checks registry — if URL exists and set has questions, skip

4. **lesson-urls.mjs**:
   - Reads from registry if entry exists, falls back to computed URLs
   - Could print registry status alongside URLs

5. **Calendar app** (follow-along repo):
   - Reads `lesson-registry.json` to auto-populate links on the weekly calendar page
   - No more manual URL entry in calendar HTML

### Backfill: Scraping Schoology for historical URLs

Previous lessons (6.1–6.9, unit 5, etc.) were posted to Schoology manually or via earlier pipeline runs. To populate the registry retroactively:

1. **New script**: `scripts/scrape-schoology-urls.mjs`
2. Connects via CDP, navigates to the course materials page
3. Walks each folder (day folders like "Monday 3/9/26")
4. Extracts link titles and URLs from each folder
5. Parses unit/lesson from titles (e.g., "Topic 6.7 — Follow-Along Worksheet" → unit 6, lesson 7)
6. Writes entries to `lesson-registry.json` with `status: "scraped"`
7. Run once to bootstrap, then pipeline keeps it current going forward

**Considerations:**
- Schoology has course sections (Period A, Period B) — scrape from Period B (the lead section)
- Some lessons span multiple folders (review days, etc.)
- Blooket URLs are in Schoology links — capture them during scrape
- Rate limit navigation to avoid Schoology throttling

## Part 2: CSV Validation in Generation Step

### Problem

Codex generates Blooket CSVs that sometimes contain:
- Commas inside answer text (breaks Blooket's parser even when quoted)
- Non-ASCII characters (≠, →, etc.) that cause encoding issues
- Wrong field count per row
- Missing or malformed Blooket header
- Trailing blank lines

Currently these are caught only after Blooket rejects the upload, wasting time and creating empty sets.

### Solution: Validate immediately after generation

Add validation to `scripts/lib/build-codex-prompts.mjs` or as a post-generation hook in `lesson-prep.mjs`:

```
function validateBlooketCsv(csvPath):
  1. Check file exists and is non-empty
  2. Verify Blooket header (first 7 lines match template exactly)
  3. Parse with a proper CSV parser (not naive comma-split)
  4. For each question row:
     a. Exactly 26 fields
     b. Question # is sequential integer
     c. 4 answer fields are non-empty
     d. Time limit is number (10-300)
     e. Correct answer is 1-4
     f. No commas inside answer text (CRITICAL — Blooket can't handle them even when quoted)
     g. No non-ASCII characters
     h. Trailing fields are empty
  5. No trailing blank lines
  6. 15-30 questions (configurable)

  Returns: { valid: boolean, errors: string[] }
```

### Fix strategy for commas in answers

Two approaches (do both):
1. **Prompt-level**: Add explicit instruction to Codex prompt: "NEVER use commas inside answer text. Use semicolons, 'and', or rephrase."
2. **Post-generation**: Auto-fix — replace commas inside answer fields with semicolons, log a warning

### Where to add validation

- In `lesson-prep.mjs` Step 2, after Codex finishes the Blooket task
- If validation fails: auto-fix what's fixable (commas → semicolons, strip BOM, trim blank lines), re-validate
- If still invalid: log errors, mark `status: "failed"` in registry, continue pipeline without Blooket

## Part 3: Preflight Check Script

### `scripts/preflight.mjs`

Run once when switching machines or after setup. Checks:

```
node scripts/preflight.mjs

Checking pipeline dependencies...
  [OK] Node.js v22.17.1
  [OK] Playwright installed (chromium)
  [OK] Python: C:\Python313\python.exe
  [OK] FFmpeg: C:\Users\rober\scoop\shims\ffmpeg.exe
  [OK] MiKTeX: C:\Users\rober\scoop\apps\miktex\...
  [OK] Edge: C:\Program Files (x86)\...\msedge.exe
  [OK] Codex CLI: ...

Checking browser sessions (CDP port 9222)...
  [OK] Edge running on port 9222
  [WARN] Not signed into Schoology (navigate to lynnschools.schoology.com)
  [WARN] Not signed into Blooket (navigate to dashboard.blooket.com)
  [OK] Signed into AI Studio

Checking repo paths...
  [OK] apstats-live-worksheet
  [OK] lrsl-driller
  [OK] curriculum_render

4 OK, 2 WARN, 0 FAIL
```

### How it checks browser sessions

Connect via CDP, check each tab/page for login indicators:
- Schoology: look for user menu or redirect to login page
- Blooket: check for username in page text
- AI Studio: check for Google account indicator

## Part 4: Upload Script Fix

The Blooket upload script (`upload-blooket.mjs`) has stale selectors:
- The `label:has-text("CSV Upload")` on the create page may have changed
- The `input[type="file"][accept=".csv"]` on the edit page needs investigation
- Modal overlays (`_modal_nbamd_3`) block clicks — need dismissal

**Action items:**
1. Manually walk through Blooket's create → edit → spreadsheet import flow in Edge DevTools
2. Update selectors in `upload-blooket.mjs` to match current Blooket UI
3. Add modal dismissal as a standard step (hide via CSS, not DOM removal)
4. Add idempotency: check registry before creating a new set

## Implementation Order

1. **CSV validation** (highest leverage — prevents the most common failure)
2. **URL registry** (enables resumability and cross-script communication)
3. **Preflight check** (quality of life for machine switching)
4. **Schoology scraper** (backfill — can do anytime)
5. **Blooket upload fix** (needs manual UI investigation first)
