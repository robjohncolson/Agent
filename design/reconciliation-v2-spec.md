# Reconciliation v2 — AI-Assisted Matching, Orphan Repair, Folder Standardization

**Goal**: Reduce reconciliation errors to near-zero by using LLM-assisted fuzzy matching, automating orphan repair, and standardizing folder naming.

**Status**: SPEC — ready for implementation

---

## Problem Statement

After the initial hardening (7-step implementation), the reconciler still surfaces issues that regex-based parsing can't solve:

1. **Rigid title parsing** — `parseTopicFromTitle()` uses ~12 regex patterns but misses non-standard naming like `"Live Worksheet — 7.2"` (fixed) or future formats the teacher hasn't used yet. Each new naming convention requires a code change.

2. **Orphaned root materials** — Materials sometimes land at the course root instead of their correct folder. Currently detected but not auto-repaired (requires CDP action to move them).

3. **Inconsistent folder names** — Folder titles vary wildly across the course: `"Monday(September 29th, 2025) apstat"` vs `"monday 2/9/26"` vs `"Friday 3/20/26"`. No standardization makes human navigation difficult and machine parsing fragile.

---

## Architecture

### Feature 1: DeepSeek-Assisted Title Parsing

**Why DeepSeek**: It's free (web UI), fast, and good at pattern extraction — exactly the right tool for "what unit.lesson does this title refer to?" The existing regex parser handles 95% of cases; DeepSeek catches the long tail.

**Approach**: Two-tier parser — regex first (fast, free), DeepSeek fallback (for unknowns).

#### New module: `scripts/lib/schoology-classify-ai.mjs`

```javascript
export async function parseTopicWithAI(title, context = {}) → { unit, lesson } | null
```

**Flow:**
1. Try `parseTopicFromTitle(title)` first (existing regex parser)
2. If null, call DeepSeek via API with a structured prompt:
   ```
   Extract the AP Statistics unit and lesson number from this Schoology material title.
   Title: "{title}"
   Context: This is in folder "{folderPath}" for an AP Statistics course.

   Return JSON: { "unit": <number>, "lesson": <number> } or null if not identifiable.
   ```
3. Cache results in `state/ai-parse-cache.json` keyed by title hash — never re-query the same title
4. Log AI-assisted parses in reconciliation report

**DeepSeek integration options:**
- **Option A: API** — Use DeepSeek API (`https://api.deepseek.com/v1/chat/completions`). Requires API key but fully automated.
- **Option B: CDP** — Send to DeepSeek web UI via CDP (like the AI Studio helper). Free but requires browser session.
- **Option C: Local model** — Use a small local model via Ollama. Fully offline but requires setup.

**Recommendation**: Option A (API) for reliability, with Option B as fallback for cost-free operation.

**Integration points:**
- `schoology-deep-scrape.mjs`: Use `parseTopicWithAI()` instead of `parseTopicFromTitle()` during scraping
- `schoology-reconcile.mjs`: When `findLessonInTree()` returns empty, try AI-assisted lookup on unmatched materials
- Cache is persistent — only novel titles cost an API call

**Cost estimate**: ~$0.001 per unmatched title. With ~10-20 unmatched titles per full scrape, total cost is negligible.

#### Prompt Engineering

The prompt should include context to disambiguate:
```
You are a parser for AP Statistics course materials on Schoology.

Given a material title and its folder location, extract the unit and lesson number.

Rules:
- AP Statistics has Units 1-9, each with ~10-15 lessons
- "Topic X.Y" always means Unit X, Lesson Y
- Quiz titles refer to the lesson they TEST (Quiz 6.9 = quiz for lesson 6.9)
- Videos may reference AP Classroom IDs — ignore those, focus on unit.lesson
- Folder context helps: if a folder is "week 24" under "Q3", the lesson is likely Unit 6-7
- Return null if genuinely ambiguous or not a lesson material

Title: "{title}"
Folder path: {folderPath}
Nearby materials: {siblingTitles}

Return ONLY valid JSON: {"unit": <int>, "lesson": <int>} or null
```

### Feature 2: Automated Orphan Repair

**Problem**: Materials at the course root belong in a specific folder. The reconciler detects them; this feature moves them.

#### New script: `scripts/schoology-repair-orphans.mjs`

```bash
node scripts/schoology-repair-orphans.mjs                    # Preview repairs
node scripts/schoology-repair-orphans.mjs --execute          # Apply repairs via CDP
node scripts/schoology-repair-orphans.mjs --unit 6 --lesson 4  # Single lesson
```

**Algorithm:**
1. Load `state/schoology-tree.json` and `state/lesson-registry.json`
2. For each orphaned material at root:
   a. Parse lesson from title (regex or AI)
   b. Look up correct folder from registry or tree
   c. If confident match: queue for move
   d. If ambiguous: skip and report
3. In `--execute` mode: Use CDP to move each material into its correct folder
4. After all moves: re-scrape affected folders to verify

**CDP move operation:**
Schoology's UI allows drag-and-drop or "Move" from the item's action menu. The script should:
1. Navigate to course materials root
2. Find the orphaned item by its `data-nid` or `id` attribute
3. Use Schoology's internal API or DOM manipulation to move it
4. Verify the move by checking the destination folder

**Safety:**
- `--execute` is required to actually move anything — default is preview-only
- Each move is logged in `state/orphan-repair-log.json`
- If a move fails, stop and report (don't continue blindly)
- Never delete materials — only move them

**Research needed**: Determine if Schoology has an internal API for moving materials (e.g., `PUT /materials/{id}/move`), or if DOM-based drag-and-drop is the only option. Check network traffic during a manual move.

### Feature 3: Folder Name Standardization

**Problem**: Folder names follow no consistent convention across the year. This makes parsing unreliable and the course hard to navigate.

**Current examples:**
```
Monday(September 29th, 2025) apstat          # Semester 1 style
THURSDAY NOV 13 2025                          # ALL CAPS
monday nov 10 2025                            # all lower
friday (3/6/26)                               # date in parens
Friday 3/20/26                                # slash date
Monday 3/9/26                                 # slash date (no parens)
Tuesday (October 7th, 2025)                   # with parens
```

**Target format:**
```
Monday 9/29/25
Thursday 11/13/25
Monday 11/10/25
Friday 3/6/26
Friday 3/20/26
Monday 3/9/26
Tuesday 10/7/25
```

Pattern: `{DayOfWeek} {M/D/YY}` — consistent, compact, parseable.

#### New module: `scripts/lib/folder-name-standardizer.mjs`

```javascript
/**
 * Standardize a Schoology folder title to "{DayOfWeek} {M/D/YY}" format.
 * @param {string} title - Original folder title
 * @returns {{ standardized: string, parsed: { dayOfWeek, month, day, year }, changed: boolean }}
 */
export function standardizeFolderName(title) { ... }

/**
 * Batch standardize all day-level folders in the tree.
 * @param {object} tree - scraped schoology-tree.json
 * @returns {{ renames: { folderId, oldTitle, newTitle }[], skipped: string[] }}
 */
export function planFolderRenames(tree) { ... }
```

**Date parsing strategy:**
1. Match known patterns with regex (covers ~90%):
   - `{Day}({MonthName} {Nth}, {Year})` → "Monday(September 29th, 2025)"
   - `{Day} {MonthName} {D} {Year}` → "monday nov 10 2025"
   - `{Day} ({M/D/YY})` → "friday (3/6/26)"
   - `{Day} {M/D/YY}` → "Friday 3/20/26"
2. Normalize to `{DayOfWeek} {M/D/YY}` with proper capitalization
3. Skip non-day folders (quarters, weeks, topic folders)
4. For ambiguous names: use DeepSeek fallback

#### New script: `scripts/schoology-rename-folders.mjs`

```bash
node scripts/schoology-rename-folders.mjs                # Preview renames
node scripts/schoology-rename-folders.mjs --execute      # Apply via CDP
```

**CDP rename operation:**
Schoology folder rename via the edit folder dialog or internal API. Each rename is logged.

**Safety:**
- Preview by default, `--execute` to apply
- Log all renames in `state/folder-rename-log.json`
- Never rename quarter/week-level folders (Q3, week 24, etc.) — only day folders
- Preserve folder IDs (renaming doesn't change the ID)

---

## Dependency Graph

```
Feature 1 (AI parsing)          Feature 3 (folder names)
    │                               │
    ▼                               ▼
Feature 2 (orphan repair)      (standalone)
    │
    ▼
Re-reconcile with fixed data
```

Features 1 and 3 are independent. Feature 2 benefits from Feature 1 (better parsing = better orphan matching).

## Implementation Waves

| Wave | Feature | Files | Est. Effort |
|------|---------|-------|-------------|
| 1 | AI-assisted parser | `lib/schoology-classify-ai.mjs`, `state/ai-parse-cache.json` | Medium |
| 2 | Folder name standardizer | `lib/folder-name-standardizer.mjs`, `schoology-rename-folders.mjs` | Medium |
| 3 | Orphan repair | `schoology-repair-orphans.mjs`, `state/orphan-repair-log.json` | Medium-Hard (CDP research needed) |
| 4 | Integration | Update scraper + reconciler to use AI parser | Easy |

## Open Questions

1. **DeepSeek API key** — Does the user have a DeepSeek API key, or should we use the CDP browser approach?
2. **Schoology move API** — Does Schoology expose an internal API for moving materials between folders, or is it DOM-only?
3. **Folder rename permissions** — Can the teacher rename folders via the Schoology UI, or is there an admin restriction?
4. **Batch size** — How many folders/materials can we rename/move per session before Schoology rate-limits?

## Success Criteria

1. Full reconciliation produces 0 errors and < 5 warnings for active units (6-7)
2. All orphaned materials are in their correct folders
3. All day-level folders follow the `{DayOfWeek} {M/D/YY}` format
4. The AI parser correctly identifies 100% of material titles (cached after first parse)
5. No Schoology session required for reconciliation (only for repair/rename operations)
