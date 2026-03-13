/**
 * load-video-links.mjs — Shared module to extract AP Classroom video URLs from units.js.
 *
 * Extracted from post-to-schoology.mjs for reuse by backfill scripts.
 */

import { existsSync, readFileSync } from "node:fs";
import { UNITS_JS_PATH } from "./paths.mjs";

/**
 * Load AP Classroom video URLs for a given unit.lesson from units.js.
 * Returns array of { key, url, title } objects.
 */
export function loadVideoLinks(unit, lesson) {
  if (!existsSync(UNITS_JS_PATH)) {
    console.warn(`  WARNING: ${UNITS_JS_PATH} not found. Skipping video links.`);
    return [];
  }

  const content = readFileSync(UNITS_JS_PATH, "utf-8");
  const lessonId = `${unit}-${lesson}`;

  // Find the lesson block by its id
  const idIndex = content.indexOf(`id: "${lessonId}"`);
  if (idIndex === -1) {
    console.warn(`  WARNING: Lesson ${lessonId} not found in units.js. Skipping video links.`);
    return [];
  }

  // Extract the description
  const afterId = content.substring(idIndex, idIndex + 500);
  const descMatch = afterId.match(/description:\s*"([^"]+)"/);
  const description = descMatch ? descMatch[1] : "";

  // Find the videos array for this lesson (before the next lesson block)
  const nextIdIndex = content.indexOf(`id: "`, idIndex + 10);
  const lessonBlock = nextIdIndex !== -1
    ? content.substring(idIndex, nextIdIndex)
    : content.substring(idIndex, idIndex + 1000);

  const urls = [];
  const urlRegex = /url:\s*"(https:\/\/apclassroom\.collegeboard\.org\/[^"]+)"/g;
  let m;
  while ((m = urlRegex.exec(lessonBlock)) !== null) {
    urls.push(m[1]);
  }

  return urls.map((url, i) => ({
    key: `video${i + 1}`,
    url,
    title: urls.length === 1
      ? `Topic ${unit}.${lesson} \u2014 AP Classroom Video`
      : `Topic ${unit}.${lesson} \u2014 AP Classroom Video ${i + 1}`,
  }));
}

/**
 * List all lesson IDs found in units.js.
 * Returns array of { unit, lesson } objects (both as numbers).
 */
export function listAllLessonIds() {
  if (!existsSync(UNITS_JS_PATH)) return [];

  const content = readFileSync(UNITS_JS_PATH, "utf-8");
  const ids = [];
  const idRegex = /id:\s*"(\d+)-(\d+)"/g;
  let m;
  while ((m = idRegex.exec(content)) !== null) {
    ids.push({ unit: parseInt(m[1], 10), lesson: parseInt(m[2], 10) });
  }
  return ids;
}
