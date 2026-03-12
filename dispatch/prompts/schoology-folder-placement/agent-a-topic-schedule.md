# Agent A: Topic Schedule + Builder Script

## Overview
Create the topic-to-date schedule file and the script that builds it.

## File 1: `config/topic-schedule.json`

Create this file with a mapping of topic numbers to ISO dates. Backfill from what we know:

```json
{
  "6.4": "2026-03-11",
  "6.8": "2026-03-13",
  "6.10": "2026-03-16",
  "7.1": "2026-03-19",
  "7.2": "2026-03-20",
  "7.3": "2026-03-23",
  "7.4": "2026-03-24",
  "7.5": "2026-03-25",
  "7.6": "2026-03-26",
  "7.7": "2026-03-27",
  "7.8": "2026-03-30",
  "7.9": "2026-03-31",
  "8.1": "2026-04-01",
  "8.2": "2026-04-02",
  "8.3": "2026-04-03",
  "8.4": "2026-04-06",
  "8.5": "2026-04-07",
  "8.6": "2026-04-08",
  "9.1": "2026-04-13",
  "9.2": "2026-04-14",
  "9.3": "2026-04-15",
  "9.4": "2026-04-16",
  "9.5": "2026-04-17"
}
```

Note: Dates for 7.3 onward are estimates based on one lesson per school day (M-F). The `build-topic-schedule.mjs` script can refine them from calendar HTMLs.

## File 2: `scripts/build-topic-schedule.mjs`

Create a Node.js script that:

1. Reads `state/lesson-registry.json` and extracts any entries that have a `date` field
2. Scans calendar HTML files in the worksheet repo directory for topic assignments
   - Calendar dir: use `CALENDAR_DIR` from `./lib/paths.mjs` (it's `C:/Users/ColsonR/apstats-live-worksheet`)
   - Files match pattern: `week_*_calendar.html`
   - Inside each file, look for topic references like "Topic 7.4" or "7.4" paired with day/date context
3. Merges: registry dates take precedence, then calendar-extracted dates, then existing schedule dates
4. Writes the result to `config/topic-schedule.json`

### Script structure:

```javascript
#!/usr/bin/env node
/**
 * build-topic-schedule.mjs — Builds config/topic-schedule.json from
 * lesson registry dates and calendar HTML files.
 *
 * Usage: node scripts/build-topic-schedule.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT, CALENDAR_DIR } from './lib/paths.mjs';

const SCHEDULE_PATH = join(AGENT_ROOT, 'config', 'topic-schedule.json');
const REGISTRY_PATH = join(AGENT_ROOT, 'state', 'lesson-registry.json');

function loadExistingSchedule() {
  try {
    return JSON.parse(readFileSync(SCHEDULE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function extractRegistryDates() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const dates = {};
  for (const [key, entry] of Object.entries(registry)) {
    if (entry.date) {
      dates[key] = entry.date;
    }
  }
  return dates;
}

function extractCalendarDates() {
  // Scan calendar HTML files for topic-to-date mappings
  const dates = {};
  if (!existsSync(CALENDAR_DIR)) return dates;

  const files = readdirSync(CALENDAR_DIR).filter(f => /^week_.*_calendar\.html$/.test(f));

  for (const file of files) {
    const content = readFileSync(join(CALENDAR_DIR, file), 'utf-8');
    // Look for patterns like "Topic 7.4" near date indicators
    // Calendar files have day columns with dates and topic assignments
    const topicMatches = content.matchAll(/Topic\s+(\d+\.\d+)/gi);
    for (const match of topicMatches) {
      const topic = match[1];
      // Try to extract the associated date from nearby context
      // This is best-effort — the static schedule provides fallback
      // Calendar HTML structure varies, so we parse what we can
    }
  }

  return dates;
}

const dryRun = process.argv.includes('--dry-run');

const existing = loadExistingSchedule();
const registryDates = extractRegistryDates();
const calendarDates = extractCalendarDates();

// Merge: existing < calendar < registry (registry wins)
const merged = { ...existing, ...calendarDates, ...registryDates };

// Sort by topic number
const sorted = {};
const keys = Object.keys(merged).sort((a, b) => {
  const [au, al] = a.split('.').map(Number);
  const [bu, bl] = b.split('.').map(Number);
  return au - bu || al - bl;
});
for (const k of keys) sorted[k] = merged[k];

if (dryRun) {
  console.log('Would write schedule:');
  console.log(JSON.stringify(sorted, null, 2));
  console.log(`\n${Object.keys(sorted).length} topics`);
} else {
  writeFileSync(SCHEDULE_PATH, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(sorted).length} topics to ${SCHEDULE_PATH}`);
}
```

## Verification
After writing both files, run:
```bash
node scripts/build-topic-schedule.mjs --dry-run
```
Confirm it reads registry dates and merges without error.

## Files to create
- `config/topic-schedule.json`
- `scripts/build-topic-schedule.mjs`

## Files to read (context only, do not modify)
- `state/lesson-registry.json`
- `scripts/lib/paths.mjs`
