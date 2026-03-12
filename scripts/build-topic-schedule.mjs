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

const MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

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

/**
 * Extract topic-to-date mappings from calendar HTML files.
 * Calendar structure: day-column divs contain a day-date span and topic-tag spans.
 */
function extractCalendarDates() {
  const dates = {};
  if (!existsSync(CALENDAR_DIR)) return dates;

  const files = readdirSync(CALENDAR_DIR).filter(f => /^week_.*_calendar\.html$/.test(f));

  for (const file of files) {
    const content = readFileSync(join(CALENDAR_DIR, file), 'utf-8');

    // Extract year from title (e.g., "Week of Mar 23-27 | AP Statistics")
    // Calendar files are for school year 2025-2026; infer year from month
    const titleMatch = content.match(/<title>Week of (\w+)\s+(\d+)/i);
    if (!titleMatch) continue;
    const titleMonth = titleMatch[1].toLowerCase().slice(0, 3);
    const monthNum = MONTH_MAP[titleMonth];
    if (monthNum === undefined) continue;
    // School year: Aug-Dec = 2025, Jan-Jul = 2026
    const year = monthNum >= 7 ? 2025 : 2026;

    // Parse day-date spans and collect topic-tags within each day-column
    // Pattern: <div class="day-date">Monday, Mar 23</div> ... <span class="topic-tag ...">7.4</span>
    let currentDate = null;
    const lines = content.split('\n');

    for (const line of lines) {
      // Match day-date: "Monday, Mar 23" or "Mar 23"
      const dateMatch = line.match(/class="day-date"[^>]*>([^<]+)</);
      if (dateMatch) {
        const dateText = dateMatch[1].trim();
        // Parse "DayName, Mon DD" or "Mon DD"
        const parts = dateText.match(/(\w{3})\s+(\d+)/);
        if (parts) {
          const mon = parts[1].toLowerCase().slice(0, 3);
          const day = parseInt(parts[2], 10);
          const m = MONTH_MAP[mon];
          if (m !== undefined) {
            const y = m >= 7 ? 2025 : 2026;
            const mm = String(m + 1).padStart(2, '0');
            const dd = String(day).padStart(2, '0');
            currentDate = `${y}-${mm}-${dd}`;
          }
        }
      }

      // Match topic-tag: <span class="topic-tag ...">7.4</span>
      if (currentDate) {
        const topicMatches = line.matchAll(/class="topic-tag[^"]*"[^>]*>(\d+\.\d+)<\/span>/g);
        for (const match of topicMatches) {
          const topic = match[1];
          if (!dates[topic]) {
            dates[topic] = currentDate;
          }
        }
        // Also match "Topic X.Y" text references
        const textMatches = line.matchAll(/Topic\s+(\d+\.\d+)/gi);
        for (const match of textMatches) {
          const topic = match[1];
          if (!dates[topic]) {
            dates[topic] = currentDate;
          }
        }
      }
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
