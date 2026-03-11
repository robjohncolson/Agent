/**
 * calendar-scan.mjs — Scan weekly calendar HTML files and extract lessons
 * from a given date range.
 *
 * Reuses the parsing approach from whats-tomorrow.mjs.
 *
 * Exports:
 *   scanCalendar(fromDate, toDate) — returns lesson entries in the date range
 *   scanAllLessons()               — convenience wrapper: today through 2026-05-08
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CALENDAR_DIR } from "./paths.mjs";

// ── Constants ───────────────────────────────────────────────────────

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Strip HTML tags from a string.
 */
export function stripHtml(str) {
  return str.replace(/<[^>]*>/g, "");
}

/**
 * Convert a date label like "Mar 12" to a Date object.
 * Assumes year 2026 for Jan–May, 2025 for Aug–Dec.
 */
export function parseDateLabel(dateLabel, year) {
  const parts = dateLabel.trim().split(/\s+/);
  if (parts.length < 2) return null;

  const monthIdx = MONTH_ABBR.indexOf(parts[0]);
  if (monthIdx === -1) return null;

  const day = parseInt(parts[1], 10);
  if (isNaN(day)) return null;

  // If an explicit year is provided, use it.
  // Otherwise infer: Jan–May → 2026, Aug–Dec → 2025, Jun–Jul → 2026
  const resolvedYear =
    year != null
      ? year
      : monthIdx <= 4
        ? 2026
        : monthIdx >= 7
          ? 2025
          : 2026;

  return new Date(resolvedYear, monthIdx, day);
}

/**
 * Format a Date as ISO date string YYYY-MM-DD.
 */
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Calendar file discovery ─────────────────────────────────────────

function findCalendarFiles() {
  try {
    const files = readdirSync(CALENDAR_DIR);
    return files
      .filter((f) => /^week.*_calendar\.html$/i.test(f) || /calendar\.html$/i.test(f))
      .map((f) => join(CALENDAR_DIR, f));
  } catch {
    return [];
  }
}

// ── HTML parsing (mirrors whats-tomorrow.mjs) ───────────────────────

/**
 * Parse period blocks within a day-column chunk.
 * Returns an array of { label, topicTags } objects.
 */
function parsePeriodBlocks(chunk) {
  const periods = [];
  const blockParts = chunk.split(/<div\s+class="period-block[^"]*">/);

  for (let i = 1; i < blockParts.length; i++) {
    const block = blockParts[i];

    // Period label (e.g. "Period B" or "Period E")
    const labelMatch = block.match(/<div\s+class="period-label">\s*(.*?)\s*<\/div>/);
    if (!labelMatch) continue;

    const rawLabel = stripHtml(labelMatch[1]).trim();
    const periodMatch = rawLabel.match(/Period\s+([A-Z])/i);
    const label = periodMatch ? periodMatch[1].toUpperCase() : rawLabel;

    // Topic tags
    const topicTags = [];
    const topicRegex = /<span\s+class="topic-tag[^"]*">\s*(.*?)\s*<\/span>/g;
    let m;
    while ((m = topicRegex.exec(block)) !== null) {
      topicTags.push(stripHtml(m[1]).trim());
    }

    periods.push({ label, topicTags });
  }

  return periods;
}

/**
 * Parse a calendar HTML file into an array of day objects:
 *   { dayName, dateLabel, periods: [{ label, topicTags }] }
 */
function parseDayColumns(html) {
  const days = [];
  const dayChunks = html.split(/<div\s+class="day-column">/);

  for (const chunk of dayChunks) {
    if (!chunk.includes("day-header")) continue;

    const nameMatch = chunk.match(/<div\s+class="day-name">\s*(.*?)\s*<\/div>/);
    const dateMatch = chunk.match(/<div\s+class="day-date">\s*(.*?)\s*<\/div>/);
    if (!nameMatch || !dateMatch) continue;

    const dayName = stripHtml(nameMatch[1]).trim();
    const dateLabel = stripHtml(dateMatch[1]).trim();
    const periods = parsePeriodBlocks(chunk);

    days.push({ dayName, dateLabel, periods });
  }

  return days;
}

// ── Topic extraction ────────────────────────────────────────────────

/**
 * Given a topic tag string (e.g. "6.4" or "6.4, 6.5"), extract all
 * unit.lesson pairs. Returns an array of { unit, lesson }.
 * Returns empty array if no parseable topic found.
 */
function extractUnitLessons(topicTag) {
  const results = [];
  const regex = /(\d+)\.(\d+)/g;
  let m;
  while ((m = regex.exec(topicTag)) !== null) {
    results.push({ unit: parseInt(m[1], 10), lesson: parseInt(m[2], 10) });
  }
  return results;
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Scan all weekly calendar HTML files and extract lesson entries within
 * the given date range [fromDate, toDate] (inclusive).
 *
 * @param {Date} fromDate - inclusive start
 * @param {Date} toDate   - inclusive end
 * @returns {Array<{ date: string, dayName: string, unit: number, lesson: number, periods: string[] }>}
 */
export function scanCalendar(fromDate, toDate) {
  const calendarFiles = findCalendarFiles();
  if (calendarFiles.length === 0) return [];

  // Normalize date boundaries to midnight
  const from = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const to = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());

  // Collect raw entries: Map keyed by "date|unit|lesson" → { date, dayName, unit, lesson, periods: Set }
  const mergeMap = new Map();

  for (const filePath of calendarFiles) {
    const html = readFileSync(filePath, "utf-8");
    const days = parseDayColumns(html);

    for (const day of days) {
      const date = parseDateLabel(day.dateLabel);
      if (!date) continue;

      // Filter to date range
      if (date < from || date > to) continue;

      const isoDate = toISODate(date);
      const dayName = day.dayName;

      for (const period of day.periods) {
        // Collect all unit.lesson pairs from all topic tags in this period block
        const unitLessons = [];
        for (const tag of period.topicTags) {
          unitLessons.push(...extractUnitLessons(tag));
        }

        // Skip entries with no parseable topic (e.g., "REVIEW", "AP EXAM")
        if (unitLessons.length === 0) continue;

        for (const { unit, lesson } of unitLessons) {
          const key = `${isoDate}|${unit}|${lesson}`;
          if (mergeMap.has(key)) {
            mergeMap.get(key).periods.add(period.label);
          } else {
            mergeMap.set(key, {
              date: isoDate,
              dayName,
              unit,
              lesson,
              periods: new Set([period.label]),
            });
          }
        }
      }
    }
  }

  // Convert Sets to sorted arrays and collect results
  const results = [];
  for (const entry of mergeMap.values()) {
    results.push({
      date: entry.date,
      dayName: entry.dayName,
      unit: entry.unit,
      lesson: entry.lesson,
      periods: [...entry.periods].sort(),
    });
  }

  // Sort by date, then unit, then lesson
  results.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.unit !== b.unit) return a.unit - b.unit;
    return a.lesson - b.lesson;
  });

  return results;
}

/**
 * Convenience wrapper: scan from today through 2026-05-08.
 */
export function scanAllLessons() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(2026, 4, 8); // May 8, 2026
  return scanCalendar(today, endDate);
}
