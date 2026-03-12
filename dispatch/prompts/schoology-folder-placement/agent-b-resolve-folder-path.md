# Agent B: resolve-folder-path.mjs

## Overview
Create a new module that determines the correct Schoology folder path for any topic. This is the core logic that replaces the calendar-only folder resolution.

## File to create: `scripts/lib/resolve-folder-path.mjs`

```javascript
#!/usr/bin/env node
/**
 * resolve-folder-path.mjs — Determines the correct Schoology folder path for a topic.
 *
 * Exports:
 *   resolveFolderPath(unit, lesson, options) → { folderPath, dayTitle, isFuture, weekNum, quarter, date }
 *   determineSchoolWeek(dateStr) → { quarter, weekNum, folderPath }
 *   formatDayTitle(dateStr) → string
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT } from './paths.mjs';

const SCHEDULE_PATH = join(AGENT_ROOT, 'config', 'topic-schedule.json');
const REGISTRY_PATH = join(AGENT_ROOT, 'state', 'lesson-registry.json');

/**
 * Determine the Schoology quarter folder and week number for a given date string.
 * Uses known anchor: week 23 = Monday Mar 2, 2026 (inside Q3).
 *
 * @param {string} dateStr - ISO date string "YYYY-MM-DD"
 * @returns {{ quarter: string, weekNum: number, folderPath: string } | null}
 */
export function determineSchoolWeek(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);

  // Get Monday of target week
  const dow = target.getDay(); // 0=Sun
  const targetMonday = new Date(target);
  targetMonday.setDate(target.getDate() - ((dow + 6) % 7));
  targetMonday.setHours(0, 0, 0, 0);

  // Known anchor: week 23 starts Monday March 2, 2026
  const anchorMonday = new Date(2026, 2, 2); // Mar 2, 2026
  anchorMonday.setHours(0, 0, 0, 0);
  const anchorWeek = 23;

  const msDiff = targetMonday.getTime() - anchorMonday.getTime();
  const weekDiff = Math.round(msDiff / (7 * 24 * 60 * 60 * 1000));
  const weekNum = anchorWeek + weekDiff;

  // Quarter assignment
  let quarter;
  if (weekNum <= 20) quarter = 'S2';
  else if (weekNum <= 30) quarter = 'Q3';
  else quarter = 'Q4';

  if (weekNum < 1) return null;

  return { quarter, weekNum, folderPath: `${quarter}/week ${weekNum}` };
}

/**
 * Format a date string as a Schoology day title.
 * E.g., "2026-03-16" → "Monday 3/16/26"
 * No zero-padding, 2-digit year.
 *
 * @param {string} dateStr - ISO date string "YYYY-MM-DD"
 * @returns {string}
 */
export function formatDayTitle(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[date.getDay()];
  const shortYear = String(y).slice(-2);
  return `${dayName} ${m}/${d}/${shortYear}`;
}

/**
 * Load the topic schedule from config/topic-schedule.json.
 * @returns {Record<string, string>} topic → ISO date
 */
function loadSchedule() {
  try {
    return JSON.parse(readFileSync(SCHEDULE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Load a lesson's date from the registry.
 * @returns {string|null} ISO date or null
 */
function loadRegistryDate(unit, lesson) {
  try {
    const reg = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
    const key = `${unit}.${lesson}`;
    return reg[key]?.date || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the full Schoology folder path for a given topic.
 *
 * @param {number} unit
 * @param {number} lesson
 * @param {object} [options]
 * @param {string} [options.date] - Explicit date override (YYYY-MM-DD)
 * @returns {{ folderPath: string[], dayTitle: string, isFuture: boolean, weekNum: number, quarter: string, date: string }}
 * @throws {Error} if no date can be resolved
 */
export function resolveFolderPath(unit, lesson, options = {}) {
  const topicKey = `${unit}.${lesson}`;

  // Step 1: Resolve date (priority: explicit > schedule > registry)
  let date = options.date || null;

  if (!date) {
    const schedule = loadSchedule();
    date = schedule[topicKey] || null;
  }

  if (!date) {
    date = loadRegistryDate(unit, lesson);
  }

  if (!date) {
    throw new Error(
      `No date found for topic ${topicKey}. ` +
      `Add it to config/topic-schedule.json, pass --date YYYY-MM-DD, ` +
      `or ensure lesson-registry.json has a date for this topic.`
    );
  }

  // Step 2: Compute week info
  const weekInfo = determineSchoolWeek(date);
  if (!weekInfo) {
    throw new Error(`Could not compute school week for date ${date} (topic ${topicKey})`);
  }

  // Step 3: Determine if future
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = date.split('-').map(Number);
  const lessonDate = new Date(y, m - 1, d);
  lessonDate.setHours(0, 0, 0, 0);
  const isFuture = lessonDate > today;

  // Step 4: Build folder path
  let folderPath;
  if (isFuture) {
    // Future lessons: work-ahead/future with title case "Week NN"
    folderPath = ['work-ahead/future', `Week ${weekInfo.weekNum}`];
  } else {
    // Current/past lessons: quarter with lowercase "week NN"
    folderPath = [weekInfo.quarter, `week ${weekInfo.weekNum}`];
  }

  const dayTitle = formatDayTitle(date);

  return {
    folderPath,
    dayTitle,
    isFuture,
    weekNum: weekInfo.weekNum,
    quarter: weekInfo.quarter,
    date,
  };
}
```

## Key design decisions
1. **Three date sources** in priority order: explicit `--date`, `config/topic-schedule.json`, `state/lesson-registry.json`
2. **Throws on no date** — never silently defaults to root posting
3. **Future detection** — compares lesson date to `new Date()` (today)
4. **Case convention** — lowercase `week NN` for current quarter, title case `Week NN` for work-ahead/future (matches existing Schoology folders)
5. **`determineSchoolWeek` is exported** — so `lesson-prep.mjs` can use it as a drop-in replacement for its inline version

## Files to create
- `scripts/lib/resolve-folder-path.mjs`

## Files to read (context only, do not modify)
- `scripts/lib/paths.mjs` (for AGENT_ROOT import)
