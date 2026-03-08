# Agent: tui-utils

## Task

Create a new file `scripts/lib/tui.mjs` that provides TUI utilities using `ora` (spinners) and `chalk` (colors). This replaces raw ANSI escape codes scattered across the pipeline scripts with a consistent, reusable module.

## File to create

`scripts/lib/tui.mjs` (NEW FILE)

## Dependencies

The project already has `ora` and `chalk` installed in the root `package.json`. Use dynamic imports to be safe:

```js
import chalk from "chalk";
import ora from "ora";
```

## Exports to implement

### 1. `createSpinner(text)` — Thin wrapper around `ora`

```js
export function createSpinner(text) {
  return ora({ text, spinner: "dots" });
}
```

### 2. `formatStatus(val)` — Colorized status string

Replace the raw ANSI version in `scripts/menu.mjs` (lines 56-66). Same logic, using chalk:

```js
export function formatStatus(val) {
  switch (val) {
    case "done":    return chalk.green("✓ done");
    case "skipped": return chalk.green("✓ skipped");
    case "scraped": return chalk.green("✓ scraped");
    case "failed":  return chalk.red("✗ failed");
    case "running": return chalk.yellow("⟳ running");
    case "pending": return chalk.yellow("○ pending");
    default:        return chalk.dim(`○ ${val || "pending"}`);
  }
}
```

### 3. `formatLinkStatus(linkEntry)` — Colorized per-link status for schoologyLinks

```js
export function formatLinkStatus(linkEntry) {
  if (!linkEntry || typeof linkEntry !== "object") {
    return chalk.dim("—");
  }
  const s = linkEntry.status;
  const ts = linkEntry.postedAt || linkEntry.attemptedAt || "";
  const time = ts ? chalk.dim(` (${ts.slice(0, 16)})`) : "";

  switch (s) {
    case "done":    return chalk.green(`✓ posted${time}`);
    case "failed":  return chalk.red(`✗ failed${time}`);
    case "skipped": return chalk.yellow(`— skipped`);
    default:        return chalk.dim(`○ ${s || "unknown"}`);
  }
}
```

### 4. `stepBanner(stepNum, title)` — Bold step header

```js
export function stepBanner(stepNum, title) {
  return chalk.bold(`=== Step ${stepNum}: ${title} ===`);
}
```

### 5. `progressBar(current, total, width = 20)` — Simple text progress bar

```js
export function progressBar(current, total, width = 20) {
  const pct = total === 0 ? 0 : Math.min(current / total, 1);
  const filled = Math.round(pct * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return `${bar} ${current}/${total}`;
}
```

### 6. `dashboardTable(entries)` — Tabular lesson overview

Takes an array of `{ key, topic, doneCount, totalSteps }` and prints a formatted table:

```js
export function dashboardTable(entries) {
  const header = `${chalk.bold("Lesson".padEnd(8))}${chalk.bold("Topic".padEnd(40))}${chalk.bold("Progress")}`;
  const divider = chalk.dim("─".repeat(68));
  const rows = entries.map((e) => {
    const bar = progressBar(e.doneCount, e.totalSteps);
    return `${e.key.padEnd(8)}${(e.topic || "(no topic)").slice(0, 38).padEnd(40)}${bar}`;
  });
  return [header, divider, ...rows].join("\n");
}
```

### 7. `errorPanel(title, message)` — Red-bordered error box

```js
export function errorPanel(title, message) {
  const border = chalk.red("─".repeat(60));
  return [
    border,
    chalk.red.bold(`  ✗ ${title}`),
    `  ${message}`,
    border,
  ].join("\n");
}
```

## Full file structure

```js
#!/usr/bin/env node
/**
 * tui.mjs — TUI utilities for the lesson-prep pipeline.
 * Provides spinners (ora), colorized formatters (chalk), and layout helpers.
 */

import chalk from "chalk";
import ora from "ora";

// ... all 7 exports above ...
```

## Constraints

- This is a NEW file — do not modify any existing files
- All 7 functions must be named exports
- No default export
- No side effects on import (no console output, no process modification)
- Use `chalk` for all coloring (no raw ANSI codes)
- Use `ora` only inside `createSpinner()`

## Verification

```bash
node --check scripts/lib/tui.mjs
node -e "import('./scripts/lib/tui.mjs').then(m => { console.log(Object.keys(m).sort().join(', ')); })"
```

Expected output:
```
createSpinner, dashboardTable, errorPanel, formatLinkStatus, formatStatus, progressBar, stepBanner
```
