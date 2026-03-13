#!/usr/bin/env node
/**
 * backfill-video-urls.mjs — Populate registry.urls.apVideos with AP Classroom
 * video URLs extracted from curriculum_render/data/units.js.
 *
 * Usage:
 *   node scripts/backfill-video-urls.mjs --dry-run    # preview only
 *   node scripts/backfill-video-urls.mjs              # update registry
 */

import { loadRegistry, saveRegistry } from "./lib/lesson-registry.mjs";
import { loadVideoLinks, listAllLessonIds } from "./lib/load-video-links.mjs";

const dryRun = process.argv.includes("--dry-run");

const registry = loadRegistry();
const allLessons = listAllLessonIds();

let updated = 0;

for (const { unit, lesson } of allLessons) {
  const key = `${unit}.${lesson}`;
  if (!registry[key]) continue;

  const videos = loadVideoLinks(unit, lesson);
  if (!registry[key].urls) registry[key].urls = {};

  const existing = JSON.stringify(registry[key].urls.apVideos || []);
  const incoming = JSON.stringify(videos);

  if (existing !== incoming) {
    if (dryRun) {
      console.log(`  [dry-run] ${key}: ${videos.length} video(s)`);
      for (const v of videos) console.log(`    ${v.url}`);
    }
    registry[key].urls.apVideos = videos;
    updated++;
  }
}

if (dryRun) {
  console.log(`\n[dry-run] Would update ${updated} lessons. No changes written.`);
} else {
  if (updated > 0) {
    saveRegistry(registry);
  }
  console.log(`Updated ${updated} lessons with AP Classroom video URLs.`);
}
