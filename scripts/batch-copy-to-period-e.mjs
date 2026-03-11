#!/usr/bin/env node
/**
 * batch-copy-to-period-e.mjs — Batch copy all missing materials from B → E.
 *
 * Scans the registry, finds every lesson where Period B has materials that
 * Period E is missing, and copies them using copy-material-to-course.mjs.
 *
 * Usage:
 *   node scripts/batch-copy-to-period-e.mjs                # Run all copies
 *   node scripts/batch-copy-to-period-e.mjs --dry-run      # Preview only
 *   node scripts/batch-copy-to-period-e.mjs --only videos  # Only copy videos
 *   node scripts/batch-copy-to-period-e.mjs --from 6.1     # Start from lesson 6.1
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { AGENT_ROOT } from './lib/paths.mjs';
import { loadRegistry } from './lib/lesson-registry.mjs';

const COPY_SCRIPT = join(AGENT_ROOT, 'scripts', 'copy-material-to-course.mjs');
const MATERIAL_TYPES = ['worksheet', 'drills', 'quiz', 'blooket'];

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let dryRun = false;
let onlyType = null;
let fromLesson = null;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--dry-run': dryRun = true; break;
    case '--only': onlyType = args[++i]; break;
    case '--from': fromLesson = args[++i]; break;
    case '--help': case '-h':
      console.log(`Usage: node scripts/batch-copy-to-period-e.mjs [options]

Options:
  --dry-run          Preview what would be copied
  --only <type>      Only copy this type (worksheet, drills, quiz, blooket, videos)
  --from <u.l>       Start from this lesson (e.g. 6.1)
  --help, -h         Show this help
`);
      process.exit(0);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function compareKeys(a, b) {
  const [au, al] = a.split('.').map(Number);
  const [bu, bl] = b.split('.').map(Number);
  return au !== bu ? au - bu : al - bl;
}

const registry = loadRegistry();
const lessons = Object.keys(registry).sort(compareKeys);

console.log('');
console.log('=== Batch Copy: Period B → Period E ===');
console.log('');

// Build work list
const workList = [];

for (const key of lessons) {
  if (fromLesson && compareKeys(key, fromLesson) < 0) continue;

  const entry = registry[key];
  const bSch = entry.schoology?.B;
  const eSch = entry.schoology?.E;

  if (!bSch?.folderId || !eSch?.folderId) continue;

  const bMats = bSch.materials || {};
  const eMats = eSch.materials || {};

  const missing = [];

  // Check keyed materials (skip if --only videos)
  if (onlyType !== 'videos') {
    for (const type of MATERIAL_TYPES) {
      if (onlyType && type !== onlyType) continue;
      if (!bMats[type]?.schoologyId) continue;
      if (eMats[type]?.schoologyId || eMats[type]?.copiedFromId) continue;
      missing.push(type);
    }
  }

  // Check videos
  if (!onlyType || onlyType === 'videos') {
    const bVids = Array.isArray(bMats.videos) ? bMats.videos.filter(v => v.schoologyId) : [];
    const eVids = Array.isArray(eMats.videos) ? eMats.videos : [];
    const eVidIds = new Set(eVids.map(v => v.copiedFromId || v.schoologyId).filter(Boolean));
    const missingVids = bVids.filter(v => !eVidIds.has(v.schoologyId));
    if (missingVids.length > 0) {
      missing.push(`videos(${missingVids.length})`);
    }
  }

  if (missing.length > 0) {
    workList.push({ key, unit: entry.unit, lesson: entry.lesson, missing });
  }
}

if (workList.length === 0) {
  console.log('Nothing to copy — Period E is fully in sync with B.');
  process.exit(0);
}

console.log(`${workList.length} lesson(s) need materials copied:\n`);
for (const item of workList) {
  console.log(`  ${item.key}: ${item.missing.join(', ')}`);
}
console.log('');

if (dryRun) {
  console.log('Dry run — no actions taken.');
  process.exit(0);
}

// Execute copies
let totalSucceeded = 0;
let totalFailed = 0;
let totalSkipped = 0;

for (const item of workList) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Copying ${item.key}...`);

  const onlyFlag = onlyType ? `--only ${onlyType}` : '';

  try {
    const output = execSync(
      `node "${COPY_SCRIPT}" --unit ${item.unit} --lesson ${item.lesson} --to-period E --no-prompt ${onlyFlag}`,
      {
        encoding: 'utf8',
        timeout: 180_000,
        cwd: AGENT_ROOT,
        env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    console.log(output);

    // Parse results from output
    const okMatch = output.match(/(\d+) succeeded/);
    const failMatch = output.match(/(\d+) failed/);
    if (okMatch) totalSucceeded += Number(okMatch[1]);
    if (failMatch) totalFailed += Number(failMatch[1]);

    if (output.includes('Nothing to copy')) totalSkipped++;
  } catch (err) {
    console.error(`  [ERROR] ${err.message?.substring(0, 200)}`);
    totalFailed++;

    // Check for rate limit (strict match to avoid false positives)
    const stderr = err.stderr || '';
    if (stderr.includes('429') || /rate.?limit/i.test(stderr)) {
      console.error('  Rate limited — stopping batch.');
      break;
    }
  }

  // Brief pause between lessons
  await new Promise(r => setTimeout(r, 2000));
}

console.log('');
console.log('=== Batch Copy Complete ===');
console.log(`  ${totalSucceeded} materials copied`);
console.log(`  ${totalFailed} failures`);
console.log(`  ${totalSkipped} lessons already in sync`);
console.log('');

if (totalFailed > 0) process.exit(1);
