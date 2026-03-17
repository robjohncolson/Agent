/**
 * sync-schedule-to-supabase.mjs — One-time migration script that reads local
 * topic-schedule.json, lesson-registry.json, and units.js, merges them, and
 * upserts all rows to the Supabase `topic_schedule` table.
 *
 * Usage:
 *   node scripts/sync-schedule-to-supabase.mjs           # dry-run (default)
 *   node scripts/sync-schedule-to-supabase.mjs --execute  # actually upserts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT, UNITS_JS_PATH } from './lib/paths.mjs';
import { upsertTopic, upsertLessonUrls } from './lib/supabase-schedule.mjs';

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const execute = process.argv.includes('--execute');

// ---------------------------------------------------------------------------
// 1. Read data sources
// ---------------------------------------------------------------------------

// topic-schedule.json  →  { B: { "6.1": "2026-03-02", ... }, E: { ... } }
const topicSchedule = JSON.parse(
  readFileSync(join(AGENT_ROOT, 'config', 'topic-schedule.json'), 'utf-8')
);

// lesson-registry.json  →  { "6.10": { unit, lesson, status, schoology, ... } }
const registry = JSON.parse(
  readFileSync(join(AGENT_ROOT, 'state', 'lesson-registry.json'), 'utf-8')
);

// units.js  →  ALL_UNITS_DATA array (plain JS, no exports)
const unitsSrc = readFileSync(UNITS_JS_PATH, 'utf-8');
const unitsFn = new Function(unitsSrc + '\nreturn ALL_UNITS_DATA;');
const allUnits = unitsFn();

// Build Map<topicKey, description> from units.js
// Topic ids in units.js use "7-3" format; we normalise to "7.3"
const descriptionMap = new Map();
for (const unit of allUnits) {
  if (!Array.isArray(unit.topics)) continue;
  for (const t of unit.topics) {
    const key = t.id.replace('-', '.');
    descriptionMap.set(key, t.description ?? t.name ?? null);
  }
}

const SPECIAL_TOPIC_TITLES = new Map([
  ['6.review', 'Unit 6 Review -- Conceptual Driller'],
]);

// ---------------------------------------------------------------------------
// 2. Merge and build rows
// ---------------------------------------------------------------------------

const periods = Object.keys(topicSchedule); // ["B", "E"]
const rows = []; // { topic, period, date, title, status, schoologyFolderId }

for (const period of periods) {
  const schedule = topicSchedule[period];
  if (!schedule) continue;

  for (const [topic, date] of Object.entries(schedule)) {
    const regEntry = registry[topic];

    // Title from special-topic overrides, then units.js, then registry topic
    let title =
      SPECIAL_TOPIC_TITLES.get(topic) ??
      descriptionMap.get(topic) ??
      regEntry?.topic ??
      null;
    if (!title) {
      console.warn(`[warn] No description found in units.js for topic ${topic} — using fallback`);
      title = `Topic ${topic}`;
    }

    // Status: registry schoology "done" → "posted", else "scheduled"
    const status =
      regEntry?.status?.schoology === 'done' ? 'posted' : 'scheduled';

    // Schoology folder ID from registry
    const schoologyFolderId =
      regEntry?.schoology?.[period]?.folderId ?? null;

    rows.push({ topic, period, date, title, status, schoologyFolderId });
  }
}

// ---------------------------------------------------------------------------
// 3. Dry-run or execute
// ---------------------------------------------------------------------------

if (!execute) {
  // Dry-run: print summary per period, then total
  for (const period of periods) {
    const periodRows = rows.filter((r) => r.period === period);
    console.log(`[dry-run] Period ${period}: ${periodRows.length} topics to sync`);
    for (const r of periodRows) {
      const folderPart = r.schoologyFolderId
        ? `folder=${r.schoologyFolderId}`
        : '(no folder ID)';
      const titleTrunc =
        r.title.length > 40 ? r.title.slice(0, 37) + '...' : r.title;
      console.log(
        `  ${r.topic.padEnd(6)} ${r.date}  ${r.status.padEnd(10)} ${JSON.stringify(titleTrunc).padEnd(44)} ${folderPart}`
      );
    }
  }
  console.log(`\nTotal: ${rows.length} rows. Run with --execute to upsert.`);
  process.exit(0);
}

// Execute mode: upsert all rows
console.log(`Upserting ${rows.length} rows to Supabase...`);
let ok = 0;
let errors = 0;

for (const r of rows) {
  const result = await upsertTopic(r.topic, r.period, {
    date: r.date,
    title: r.title,
    status: r.status,
    schoologyFolderId: r.schoologyFolderId,
  });

  if (result.ok) {
    ok++;
  } else {
    errors++;
    console.error(`  [error] ${r.period}/${r.topic}: ${result.error}`);
  }
}

console.log(`\nDone. ${ok} topic_schedule rows upserted, ${errors} errors.`);

// ---------------------------------------------------------------------------
// 4. Backfill lesson_urls (topic-global material URLs)
// ---------------------------------------------------------------------------

console.log(`\nBackfilling lesson_urls from registry...`);
const seenTopics = new Set();
let urlOk = 0;
let urlErrors = 0;

for (const [topic, entry] of Object.entries(registry)) {
  if (seenTopics.has(topic)) continue;
  seenTopics.add(topic);

  const fields = {};

  // Worksheet, quiz, blooket from top-level urls
  if (entry.urls?.worksheet) fields.worksheetUrl = entry.urls.worksheet;
  if (entry.urls?.quiz)      fields.quizUrl = entry.urls.quiz;
  if (entry.urls?.blooket)   fields.blooketUrl = entry.urls.blooket;

  // Drills: top-level first, then fall back to per-material posting data
  if (entry.urls?.drills) {
    fields.drillsUrl = entry.urls.drills;
  } else {
    const matDrills =
      entry.schoology?.B?.materials?.drills?.targetUrl ||
      entry.schoology?.E?.materials?.drills?.targetUrl;
    if (matDrills) fields.drillsUrl = matDrills;
  }

  if (Object.keys(fields).length === 0) continue;

  const result = await upsertLessonUrls(topic, fields);
  if (result.ok) {
    urlOk++;
  } else {
    urlErrors++;
    console.error(`  [error] lesson_urls ${topic}: ${result.error}`);
  }
}

console.log(`lesson_urls: ${urlOk} upserted, ${urlErrors} errors.`);
if (errors > 0 || urlErrors > 0) process.exit(1);
