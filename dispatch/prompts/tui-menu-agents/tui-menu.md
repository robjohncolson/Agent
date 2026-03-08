# Agent: tui-menu

## Task

Create `scripts/menu.mjs` — a single-file TUI (terminal user interface) menu for the lesson-prep pipeline. This replaces memorizing CLI flags with arrow-key navigation.

## Architecture

- Single ESM file at `scripts/menu.mjs`
- Uses the `prompts` npm package (select, multiselect, number, text, confirm)
- Invokes existing scripts via `execSync` with `{ stdio: "inherit", cwd: AGENT_ROOT }`
- Loads lesson registry to show status and pre-select skip toggles
- Ctrl+C at any prompt exits cleanly (no stack trace)

## Imports from existing code

```js
import { loadRegistry, getLesson } from "./lib/lesson-registry.mjs";
import { SCRIPTS, AGENT_ROOT } from "./lib/paths.mjs";
import { execSync } from "node:child_process";
import prompts from "prompts";
```

## Available library APIs

### lesson-registry.mjs
- `loadRegistry()` → returns object like `{ "6.10": { unit, lesson, topic, date, urls: {...}, status: { ingest, worksheet, drills, blooketCsv, blooketUpload, animations, schoology }, timestamps }, ... }`
- `getLesson(unit, lesson)` → returns single entry or `null`
- Status values: `"pending"`, `"running"`, `"done"`, `"failed"`, `"skipped"`, `"scraped"`

### paths.mjs
- `AGENT_ROOT` → string, base directory of the Agent repo
- `SCRIPTS` → object with keys: `whatsTomorrow`, `aistudioIngest`, `renderAnimations`, `uploadAnimations`, `uploadBlooket`, `postSchoology`, `indexDriveVideos`, `lessonUrls`
  - Each value is a full absolute path to the script

## Menu tree implementation

### Main menu (loop until Quit)

```
Lesson-Prep Pipeline
─────────────────────
> Prep for tomorrow (auto-detect)
  Prep specific lesson
  View lesson status
  Get lesson URLs
  Run preflight check
  Utility tools
  Quit
```

Use `prompts({ type: "select", ... })` in a `while(true)` loop. On Ctrl+C or "Quit", exit with `process.exit(0)`.

### 1. Prep for tomorrow (auto-detect)

1. Run `node ${SCRIPTS.whatsTomorrow}` and capture stdout (use `execSync` with `encoding: "utf-8"` — NOT `stdio: "inherit"` since we need to parse output).
2. Parse output with regex `/Topic:\s+(\d+)\.(\d+)/` to extract unit and lesson numbers.
3. If parse fails, show "Could not auto-detect tomorrow's lesson" and return to menu.
4. Show detected topic to user: `"Detected: Unit ${unit}, Lesson ${lesson}"`.
5. Check registry via `getLesson(unit, lesson)` — if entry exists, determine which steps are already done.
6. Show multiselect for skip toggles (see "Skip toggles" section below) with done steps pre-selected.
7. Build and run command: `node scripts/lesson-prep.mjs --auto --skip-X --skip-Y ...`
   - Use `execSync` with `{ stdio: "inherit", cwd: AGENT_ROOT }` for live output.

### 2. Prep specific lesson

1. Prompt for unit number: `{ type: "number", name: "unit", message: "Unit number (1-9):", min: 1, max: 9 }`
2. Prompt for lesson number: `{ type: "number", name: "lesson", message: "Lesson number (1-15):", min: 1, max: 15 }`
3. Check registry via `getLesson(unit, lesson)` — if found, show current status summary.
4. Show multiselect for skip toggles with registry-aware defaults.
5. Build and run: `node scripts/lesson-prep.mjs --unit ${unit} --lesson ${lesson} --skip-X ...`

### 3. View lesson status

1. Load full registry via `loadRegistry()`.
2. If empty, show "No lessons in registry" and return.
3. For each entry, compute progress: count statuses that are `"done"` or `"skipped"` out of total 7 steps.
4. Format as list: `"6.10 — Topic Name [5/7 done]"` or `"6.10 — (no topic) [5/7 done]"` if topic is null.
5. Show as `prompts({ type: "select" })` list with a "Back" option at the end.
6. On selection, display detailed status:
   ```
   Lesson 6.10 — Topic Name
   ─────────────────────────
   ingest:        ✓ done
   worksheet:     ✓ done
   drills:        ✓ done
   blooketCsv:    ✓ done
   blooketUpload: ✗ failed
   animations:    ○ pending
   schoology:     ✓ done

   URLs:
     worksheet:  https://...
     blooket:    https://...
   ```
7. Use symbols: `✓` for done/skipped/scraped, `✗` for failed, `○` for pending, `⟳` for running.
8. After display, show `prompts({ type: "confirm", message: "Back to menu?" })` or just return.

### 4. Get lesson URLs

1. Prompt for unit and lesson (same as "Prep specific lesson" steps 1-2).
2. Run `node ${SCRIPTS.lessonUrls} --unit ${unit} --lesson ${lesson}` with `{ stdio: "inherit" }`.

### 5. Run preflight check

1. Run `node scripts/preflight.mjs` with `{ stdio: "inherit", cwd: AGENT_ROOT }`.

### 6. Utility tools (submenu)

Show a nested select menu:
```
Utility Tools
─────────────
> Reindex Drive videos
  Scrape Schoology URLs
  Upload Blooket set (manual)
  Post to Schoology (manual)
  Back
```

Actions:
- **Reindex Drive videos**: `node ${SCRIPTS.indexDriveVideos}` with `stdio: "inherit"`
- **Scrape Schoology URLs**: `node scripts/scrape-schoology-urls.mjs` with `stdio: "inherit"`
- **Upload Blooket set**: prompt for unit + lesson, then `node ${SCRIPTS.uploadBlooket} --unit ${unit} --lesson ${lesson}` with `stdio: "inherit"`
- **Post to Schoology**: prompt for unit + lesson, then `node ${SCRIPTS.postSchoology} --unit ${unit} --lesson ${lesson}` with `stdio: "inherit"`
- **Back**: return to main menu

## Skip toggles (multiselect)

The skip multiselect should have these options:

```js
const SKIP_OPTIONS = [
  { title: "Skip video ingest",    value: "--skip-ingest",    statusKey: "ingest" },
  { title: "Skip render animations", value: "--skip-render",  statusKey: "animations" },
  { title: "Skip upload animations", value: "--skip-upload",  statusKey: "animations" },
  { title: "Skip Blooket upload",   value: "--skip-blooket",  statusKey: "blooketUpload" },
  { title: "Skip Schoology post",   value: "--skip-schoology", statusKey: "schoology" },
];
```

When a registry entry exists, pre-select options where the corresponding `statusKey` is `"done"` or `"skipped"` or `"scraped"`. Use the `selected` property in prompts multiselect.

## Ctrl+C handling

At the top of the file, add:
```js
const onCancel = () => { process.exit(0); };
```

Pass this to every `prompts()` call:
```js
const response = await prompts({ ... }, { onCancel });
```

## Error handling

Wrap every `execSync` call in try/catch:
```js
try {
  execSync(cmd, { stdio: "inherit", cwd: AGENT_ROOT });
} catch (err) {
  console.error(`\nCommand failed with exit code ${err.status}`);
}
```

After any script execution (success or failure), pause briefly then return to the main menu loop. Do NOT exit the process on script failure.

## Console styling

Use simple ANSI where helpful:
```js
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
```

Use these for:
- Section headers (bold)
- Status badges (green=done, yellow=pending/running, red=failed)
- Separator lines (dim)

## File structure outline

```
#!/usr/bin/env node
// imports
// ANSI constants
// skip options constant
// onCancel handler
// helper: runScript(cmd) — execSync wrapper
// helper: getSkipFlags(unit, lesson) — returns pre-selected indices
// helper: buildSkipArgs(selected) — returns CLI string
// helper: formatStatus(statusValue) — returns colored symbol
// helper: formatLessonSummary(key, entry) — returns "6.10 — Topic [N/7]"
// async function prepTomorrow()
// async function prepSpecific()
// async function viewStatus()
// async function getLessonUrls()
// async function runPreflight()
// async function utilityTools()
// async function main() — the menu loop
// main().catch(console.error)
```

## Constraints

- Create ONLY `scripts/menu.mjs`, no other files
- Do NOT modify any existing scripts
- Do NOT import anything not listed in the imports section above
- The file must be valid ESM (import/export, no require())
- Target ~250-350 lines
- All prompts() calls must use the onCancel handler
