#!/usr/bin/env node
/**
 * resolve-folder-path.mjs — Determines the correct Schoology folder path for a topic.
 *
 * Exports:
 *   resolveFolderPath(unit, lesson, options) → { folderPath, dayTitle, isFuture, weekNum, quarter, date }
 *   determineSchoolWeek(dateStr) → { quarter, weekNum, folderPath }
 *   formatDayTitle(dateStr) → string
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_ROOT } from "./paths.mjs";

const SCHEDULE_PATH = join(AGENT_ROOT, "config", "topic-schedule.json");
const REGISTRY_PATH = join(AGENT_ROOT, "state", "lesson-registry.json");

function parseIsoDate(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Determine the Schoology quarter folder and week number for a given date string.
 * Uses known anchor: week 23 = Monday Mar 2, 2026 (inside Q3).
 *
 * @param {string} dateStr - ISO date string "YYYY-MM-DD"
 * @returns {{ quarter: string, weekNum: number, folderPath: string } | null}
 */
export function determineSchoolWeek(dateStr) {
  if (!dateStr) return null;

  const target = parseIsoDate(dateStr);

  // Get Monday of target week.
  const dow = target.getDay(); // 0=Sun
  const targetMonday = new Date(target);
  targetMonday.setDate(target.getDate() - ((dow + 6) % 7));
  targetMonday.setHours(0, 0, 0, 0);

  // Known anchor: week 23 starts Monday March 2, 2026.
  const anchorMonday = new Date(2026, 2, 2);
  anchorMonday.setHours(0, 0, 0, 0);
  const anchorWeek = 23;

  const msDiff = targetMonday.getTime() - anchorMonday.getTime();
  const weekDiff = Math.round(msDiff / (7 * 24 * 60 * 60 * 1000));
  const weekNum = anchorWeek + weekDiff;

  let quarter;
  if (weekNum <= 20) {
    quarter = "S2";
  } else if (weekNum <= 30) {
    quarter = "Q3";
  } else {
    quarter = "Q4";
  }

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
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = dayNames[date.getDay()];
  const shortYear = String(year).slice(-2);
  return `${dayName} ${month}/${day}/${shortYear}`;
}

/**
 * Load the topic schedule from config/topic-schedule.json.
 * @returns {Record<string, string>} topic → ISO date
 */
function loadSchedule() {
  try {
    return JSON.parse(readFileSync(SCHEDULE_PATH, "utf-8"));
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
    const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
    const key = `${unit}.${lesson}`;
    return registry[key]?.date || null;
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

  // Step 1: Resolve date (priority: explicit > schedule > registry).
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
        `or ensure lesson-registry.json has a date for this topic.`,
    );
  }

  // Step 2: Compute week info.
  const weekInfo = determineSchoolWeek(date);
  if (!weekInfo) {
    throw new Error(`Could not compute school week for date ${date} (topic ${topicKey})`);
  }

  // Step 3: Determine if future.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lessonDate = parseIsoDate(date);
  lessonDate.setHours(0, 0, 0, 0);
  const isFuture = lessonDate > today;

  // Step 4: Build folder path.
  let folderPath;
  if (isFuture) {
    // Future lessons: work-ahead/future with title case "Week NN".
    folderPath = ["work-ahead/future", `Week ${weekInfo.weekNum}`];
  } else {
    // Current/past lessons: quarter with lowercase "week NN".
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
