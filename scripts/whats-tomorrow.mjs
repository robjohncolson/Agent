#!/usr/bin/env node
/**
 * whats-tomorrow.mjs
 *
 * Parse weekly calendar HTML files to show what topics are scheduled
 * for tomorrow (or a given date).
 *
 * Usage:
 *   node scripts/whats-tomorrow.mjs                    # defaults to tomorrow
 *   node scripts/whats-tomorrow.mjs --date 2026-03-05  # specific date
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CALENDAR_DIR } from "./lib/paths.mjs";

// ── Date handling ──────────────────────────────────────────────────

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--date");
  if (idx !== -1 && args[idx + 1]) {
    const [y, m, d] = args[idx + 1].split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  // Default: tomorrow
  const now = new Date();
  now.setDate(now.getDate() + 1);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDateLabel(date) {
  return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}`;
}

function formatHeader(date) {
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_ABBR[date.getMonth()]} ${date.getDate()}`;
}

// ── Calendar file discovery ────────────────────────────────────────

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

// ── HTML parsing ───────────────────────────────────────────────────

/**
 * Split the HTML into day-column blocks, then parse each one.
 * Returns an array of day objects: { dateLabel, dayName, periods[] }
 */
function parseDayColumns(html) {
  const days = [];

  // Split on day-column divs. We use a regex that captures each block.
  const dayColRegex = /<div\s+class="day-column">([\s\S]*?)(?=<div\s+class="day-column">|<\/div>\s*<\/div>\s*(?:<div\s+class="footer">|<\/div>\s*<\/div>|$))/g;

  // Simpler approach: find all day-header blocks and the content after them
  const dayChunks = html.split(/<div\s+class="day-column">/);

  for (const chunk of dayChunks) {
    if (!chunk.includes("day-header")) continue;

    // Extract day name and date
    const nameMatch = chunk.match(/<div\s+class="day-name">\s*(.*?)\s*<\/div>/);
    const dateMatch = chunk.match(/<div\s+class="day-date">\s*(.*?)\s*<\/div>/);
    if (!nameMatch || !dateMatch) continue;

    const dayName = stripHtml(nameMatch[1]).trim();
    const dateLabel = stripHtml(dateMatch[1]).trim();

    // Extract period blocks
    const periods = parsePeriodBlocks(chunk);

    days.push({ dayName, dateLabel, periods });
  }

  return days;
}

/**
 * Parse all period blocks within a day-column chunk.
 */
function parsePeriodBlocks(chunk) {
  const periods = [];

  // Split on period-block boundaries
  const blockParts = chunk.split(/<div\s+class="period-block[^"]*">/);

  for (let i = 1; i < blockParts.length; i++) {
    const block = blockParts[i];
    const period = parseSinglePeriod(block);
    if (period) periods.push(period);
  }

  return periods;
}

/**
 * Parse a single period block into { label, topics, title, due, assign }.
 */
function parseSinglePeriod(block) {
  // Period label (e.g. "Period B" or "Period E")
  const labelMatch = block.match(/<div\s+class="period-label">\s*(.*?)\s*<\/div>/);
  if (!labelMatch) return null;

  const rawLabel = stripHtml(labelMatch[1]).trim();
  // Normalize: extract "Period B" or "Period E"
  const periodMatch = rawLabel.match(/Period\s+([A-Z])/i);
  const label = periodMatch ? `Period ${periodMatch[1].toUpperCase()}` : rawLabel;

  // Topic tags
  const topicTags = [];
  const topicRegex = /<span\s+class="topic-tag[^"]*">\s*(.*?)\s*<\/span>/g;
  let m;
  while ((m = topicRegex.exec(block)) !== null) {
    topicTags.push(stripHtml(m[1]).trim());
  }

  // Content title
  const titleMatch = block.match(/<div\s+class="content-title">\s*(.*?)\s*<\/div>/);
  const title = titleMatch ? stripHtml(titleMatch[1]).trim() : "";

  // Due items
  const dueItems = [];
  const dueRegex = /<span\s+class="due-item">\s*(.*?)\s*<\/span>/g;
  while ((m = dueRegex.exec(block)) !== null) {
    dueItems.push(stripHtml(m[1]).trim());
  }

  // Assign items
  const assignItems = [];
  const assignRegex = /<span\s+class="assign-item">\s*(.*?)\s*<\/span>/g;
  while ((m = assignRegex.exec(block)) !== null) {
    assignItems.push(stripHtml(m[1]).trim());
  }

  // Build topic string: "6.4 — Setting Up a Test for p"
  let topicStr = "";
  if (topicTags.length > 0 && title) {
    topicStr = `${topicTags.join(", ")} — ${title}`;
  } else if (topicTags.length > 0) {
    topicStr = topicTags.join(", ");
  } else if (title) {
    topicStr = title;
  }

  return {
    label,
    topic: topicStr,
    due: dueItems,
    assign: assignItems,
  };
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(str) {
  return str.replace(/<[^>]*>/g, "");
}

// ── Main ───────────────────────────────────────────────────────────

function main() {
  const targetDate = parseArgs();
  const targetLabel = formatDateLabel(targetDate);

  const calendarFiles = findCalendarFiles();
  if (calendarFiles.length === 0) {
    console.error(
      `No calendar files found in ${CALENDAR_DIR}.\n` +
      `Expected files matching week*_calendar.html or *calendar.html.`
    );
    process.exit(1);
  }

  // Search all calendar files for the target date.
  // If multiple files contain the same date, prefer the one with
  // the most detail (most period blocks with due/assign items).
  let matchedDay = null;
  let bestScore = -1;

  for (const filePath of calendarFiles) {
    const html = readFileSync(filePath, "utf-8");
    const days = parseDayColumns(html);

    for (const day of days) {
      if (day.dateLabel === targetLabel) {
        // Score by amount of detail: periods + due items + assign items
        let score = day.periods.length;
        for (const p of day.periods) {
          score += p.due.length + p.assign.length;
          if (p.topic) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          matchedDay = day;
        }
      }
    }
  }

  if (!matchedDay) {
    console.log(
      `No calendar entry found for ${formatHeader(targetDate)} (${targetLabel}).\n` +
      `The calendar file for that week may not have been created yet.`
    );
    process.exit(0);
  }

  // Format output
  console.log(formatHeader(targetDate));
  console.log();

  if (matchedDay.periods.length === 0) {
    console.log("  No class periods scheduled.");
    return;
  }

  for (const p of matchedDay.periods) {
    console.log(`${p.label}:`);
    if (p.topic) {
      console.log(`  Topic: ${p.topic}`);
    }
    if (p.due.length > 0) {
      console.log(`  Due:   ${p.due.join(", ")}`);
    }
    if (p.assign.length > 0) {
      console.log(`  Assign: ${p.assign.join(", ")}`);
    }
    console.log();
  }
}

main();
