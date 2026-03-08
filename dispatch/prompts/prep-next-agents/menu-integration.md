# Agent: menu-integration

## Task

Modify `scripts/menu.mjs` to add the "Prep next undeveloped" menu option. This imports the new `scanCalendars()` function from `scripts/lib/scan-calendars.mjs` (created by a prior agent) and adds a `prepNextUndeveloped()` menu action.

## File to modify

`scripts/menu.mjs` — the existing TUI menu file (294 lines).

## Current state of menu.mjs

The file already has:
- Imports: `loadRegistry`, `getLesson` from `./lib/lesson-registry.mjs`; `SCRIPTS`, `AGENT_ROOT` from `./lib/paths.mjs`; `execSync` from `node:child_process`; `prompts` from `prompts`
- ANSI constants: `BOLD`, `DIM`, `GREEN`, `YELLOW`, `RED`, `CYAN`, `RESET`
- `SKIP_OPTIONS` array, `onCancel` handler
- Helpers: `runScript()`, `getPreselected()`, `buildSkipArgs()`, `formatStatus()`, `formatLessonSummary()`, `promptUnitLesson()`, `showSkipToggles()`
- Menu actions: `prepTomorrow()`, `prepSpecific()`, `viewStatus()`, `getLessonUrls()`, `runPreflight()`, `utilityTools()`
- Main menu loop in `main()` with choices: auto, specific, status, urls, preflight, utils, quit

## Changes required

### 1. Add import (line 2 area)

Add this import after the existing imports (after line 5):

```js
import { scanCalendars } from "./lib/scan-calendars.mjs";
```

### 2. Add `prepNextUndeveloped()` function

Insert this new async function in the "Menu actions" section, BEFORE the `prepTomorrow()` function (before line 104). The function should:

1. Call `scanCalendars()` to get the full sorted lesson list.
2. Load the registry via `loadRegistry()`.
3. Define `STATUS_KEYS`:
   ```js
   const STATUS_KEYS = ["ingest", "worksheet", "drills", "blooketCsv", "blooketUpload", "animations", "schoology"];
   ```
4. For each calendar lesson, check the registry:
   - Get entry via `getLesson(item.unit, item.lesson)`
   - If no entry: mark as "not started", doneCount = 0
   - If entry exists: count how many of the 7 STATUS_KEYS have value `"done"`, `"skipped"`, or `"scraped"`. If all 7 are resolved, skip this lesson (it's done). Otherwise mark as incomplete.
5. Build a list of undeveloped lessons. If empty, print `"All calendar lessons are fully prepped!"` and return.
6. Build `prompts` choices array. Each choice should display:
   ```
   ○ Mar  9  6.6  — Concluding a Test for p           [not started]
   ◐ Mar 10  6.7  — Potential Errors (Type I & II)     [3/7 done]
   ```
   Format the date part with the dateLabel right-padded to 6 chars, the unit.lesson left-padded, and the title truncated to ~40 chars if needed.
   Use `○` (yellow) for not started, `◐` (yellow) for incomplete.
   Add a dimmed "Back" option at the end with value `"__back__"`.

7. Show `prompts({ type: "select" })` for the user to pick a lesson.
8. If user selects Back or cancels, return.
9. On selection: extract unit and lesson from the selected value.
10. Show current status detail if entry exists (same pattern as `prepSpecific()`):
    ```js
    const entry = getLesson(unit, lesson);
    if (entry) {
      console.log(`\n${DIM}Current status for ${unit}.${lesson}:${RESET}`);
      for (const s of STATUS_KEYS) {
        console.log(`  ${s.padEnd(16)} ${formatStatus(entry.status?.[s])}`);
      }
      console.log();
    }
    ```
11. Show skip toggles via existing `showSkipToggles(unit, lesson)`.
12. Build and run command:
    ```js
    const skipStr = buildSkipArgs(skips);
    const cmd = `node scripts/lesson-prep.mjs --unit ${unit} --lesson ${lesson}${skipStr ? " " + skipStr : ""}`;
    console.log(`\n${DIM}> ${cmd}${RESET}\n`);
    runScript(cmd);
    ```
13. Return to main menu (do NOT loop back to the undeveloped list).

### 3. Add header before the list

Before showing the select prompt, print:
```js
console.log(`\n${BOLD}Undeveloped Lessons (Period B)${RESET}`);
console.log(`${DIM}${"─".repeat(30)}${RESET}`);
```

### 4. Update main menu choices

In the `main()` function, add the new option as the FIRST choice (before "Prep for tomorrow"):

```js
{ title: "Prep next undeveloped",              value: "next" },
```

### 5. Update switch statement

In the `main()` function's switch block, add:

```js
case "next":      await prepNextUndeveloped(); break;
```

## Choice value format

Each undeveloped lesson choice should have a value of `"unit:lesson"` format (e.g. `"6:8"`), so it can be parsed back:

```js
const [unit, lesson] = selected.split(":").map(Number);
```

## Constraints

- Only modify `scripts/menu.mjs`
- Do NOT modify any other files
- Do NOT create any new files
- Reuse existing helpers (`formatStatus`, `showSkipToggles`, `buildSkipArgs`, `runScript`, `getPreselected`)
- All `prompts()` calls must include `{ onCancel }`
- Valid ESM syntax
- The file should stay under ~370 lines total (currently 294, adding ~60-70 lines)
