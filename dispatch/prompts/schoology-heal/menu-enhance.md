# Agent: menu-enhance

## Task

Enhance `scripts/menu.mjs` to:
1. Replace raw ANSI escape codes with `chalk` imports
2. Replace the local `formatStatus()` with the one from `tui.mjs`
3. Add "Dashboard" and "Heal Schoology links" menu items
4. Enhance `viewStatus()` to show per-link detail from `getSchoologyLinks()`

## File to modify

`scripts/menu.mjs` (365 lines)

## Current state

Lines 1-15 import and define ANSI constants:
```js
import { loadRegistry, getLesson } from "./lib/lesson-registry.mjs";
import { SCRIPTS, AGENT_ROOT } from "./lib/paths.mjs";
import { execSync } from "node:child_process";
import prompts from "prompts";
import { scanCalendars } from "./lib/scan-calendars.mjs";

const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED   = "\x1b[31m";
const CYAN  = "\x1b[36m";
const RESET = "\x1b[0m";
```

Lines 56-66 define a local `formatStatus()` with raw ANSI codes.

## Changes

### 1. Replace ANSI constants with chalk (lines 8-15)

Remove the 7 ANSI constant lines. Add these imports at the top (after the existing imports):

```js
import chalk from "chalk";
import { formatStatus, formatLinkStatus, dashboardTable, progressBar } from "./lib/tui.mjs";
import { getSchoologyLinks } from "./lib/lesson-registry.mjs";
```

Update the first import line to also import `getSchoologyLinks`:
```js
import { loadRegistry, getLesson, getSchoologyLinks } from "./lib/lesson-registry.mjs";
```

### 2. Remove local `formatStatus()` (lines 56-66)

Delete the entire function — it's now imported from `tui.mjs`.

### 3. Replace all ANSI references throughout the file

Replace all uses of the old ANSI constants with chalk equivalents:
- `${BOLD}text${RESET}` → `chalk.bold("text")`
- `${DIM}text${RESET}` → `chalk.dim("text")`
- `${GREEN}text${RESET}` → `chalk.green("text")`
- `${YELLOW}text${RESET}` → `chalk.yellow("text")`
- `${RED}text${RESET}` → `chalk.red("text")`
- `${CYAN}text${RESET}` → `chalk.cyan("text")`

There are approximately 20-25 places where these are used. Be thorough — search for every `${BOLD}`, `${DIM}`, `${GREEN}`, `${YELLOW}`, `${RED}`, `${CYAN}`, `${RESET}` reference and replace.

Key locations (non-exhaustive):
- `formatLessonSummary()` — no ANSI there, but check
- `prepNextUndeveloped()` — `${BOLD}Undeveloped Lessons...${RESET}`, `${DIM}─${RESET}`, `${YELLOW}${icon}${RESET}`, `${DIM}Back${RESET}`
- `prepTomorrow()` — `${BOLD}...${RESET}`, `${CYAN}...${RESET}`, `${DIM}...${RESET}`
- `prepSpecific()` — `${DIM}...${RESET}`
- `viewStatus()` — `${BOLD}...${RESET}`, `${DIM}─${RESET}`, `${BOLD}URLs:${RESET}`, `${CYAN}...${RESET}`
- `utilityTools()` — `${BOLD}...${RESET}`, `${DIM}─${RESET}`, `${DIM}Back${RESET}`
- `main()` — `${BOLD}Lesson-Prep Pipeline${RESET}`, `${DIM}─${RESET}`, `${RED}Quit${RESET}`

### 4. Add "Dashboard" menu action

Add a new `async function showDashboard()`:

```js
async function showDashboard() {
  const registry = loadRegistry();
  const keys = Object.keys(registry);
  if (keys.length === 0) {
    console.log("\nNo lessons in registry.\n");
    return;
  }

  const STATUS_STEPS = ["ingest", "worksheet", "drills", "blooketCsv", "blooketUpload", "animations", "schoology"];
  const entries = keys.map((k) => {
    const e = registry[k];
    const doneCount = STATUS_STEPS.filter((s) => {
      const v = e.status?.[s];
      return v === "done" || v === "skipped" || v === "scraped";
    }).length;
    return { key: k, topic: e.topic, doneCount, totalSteps: STATUS_STEPS.length };
  });

  console.log(`\n${chalk.bold("Lesson Dashboard")}`);
  console.log(dashboardTable(entries));
  console.log();
}
```

### 5. Add "Heal Schoology links" menu action

Add a new `async function healSchoologyLinks()`:

```js
async function healSchoologyLinks() {
  const { unit, lesson } = await promptUnitLesson();
  if (unit == null || lesson == null) return;

  const entry = getLesson(unit, lesson);
  if (!entry) {
    console.log(chalk.yellow(`\nNo registry entry for ${unit}.${lesson}. Run the pipeline first.\n`));
    return;
  }

  const cmd = `node scripts/post-to-schoology.mjs --unit ${unit} --lesson ${lesson} --auto-urls --heal --no-prompt`;
  console.log(chalk.dim(`\n> ${cmd}\n`));
  runScript(cmd);
}
```

### 6. Enhance `viewStatus()` — add schoologyLinks detail (after line 265)

After printing the 7 status steps, add a section for schoologyLinks:

```js
  // Show per-link Schoology detail
  const scLinks = getSchoologyLinks(entry.unit, entry.lesson);
  if (scLinks) {
    console.log(`\n${chalk.bold("Schoology Links:")}`);
    for (const [linkKey, linkEntry] of Object.entries(scLinks)) {
      console.log(`  ${linkKey.padEnd(16)} ${formatLinkStatus(linkEntry)}`);
    }
  }
```

Insert this after the status step loop and before the URLs section (before `const urls = entry.urls || {};`).

### 7. Add new items to main menu choices (in `main()`)

Add these two choices to the main menu array, before the "Quit" option:

```js
{ title: "Dashboard",               value: "dashboard" },
{ title: "Heal Schoology links",    value: "heal" },
```

And add cases in the switch:
```js
case "dashboard": await showDashboard(); break;
case "heal":      await healSchoologyLinks(); break;
```

## Constraints

- Only modify `scripts/menu.mjs`
- Every raw ANSI code must be replaced — no `\x1b[` should remain in the file after edits
- The `formatStatus` import from tui.mjs must match the exact same output semantics as the original
- Do NOT change the prompts library usage or the menu flow logic

## Verification

```bash
node --check scripts/menu.mjs
# Verify no raw ANSI codes remain:
grep -c '\\x1b' scripts/menu.mjs  # should be 0
```
