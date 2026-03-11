#!/usr/bin/env node
/**
 * catch-up.mjs — Idempotent, resilient lesson prep orchestrator.
 *
 * Scans the calendar from today through May 8, diffs against registry state,
 * builds a persistent work queue, and processes it — surviving rate limits,
 * CDP unavailability, and restarts.
 *
 * Usage:
 *   node scripts/catch-up.mjs                    # Scan + process queue
 *   node scripts/catch-up.mjs --preview           # Show what would be queued
 *   node scripts/catch-up.mjs --status            # Show queue status
 *   node scripts/catch-up.mjs --rescan            # Force re-scan calendar
 *   node scripts/catch-up.mjs --retry-failed      # Reset failed actions
 *   node scripts/catch-up.mjs --unit 6 --lesson 8 # Process single lesson
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

import { parseArgs } from 'node:util';
import { scanCalendar, scanAllLessons } from './lib/calendar-scan.mjs';
import { diffLessons } from './lib/catch-up-diff.mjs';
import { executeAction } from './lib/catch-up-executors.mjs';
import {
  loadQueue,
  saveQueue,
  enqueueAction,
  getReadyActions,
  markRunning,
  markCompleted,
  markSkipped,
  markFailed,
  markRateLimited,
  retryFailed,
  computeStats,
  formatStats,
  getBackoffForAction,
  STATUS,
} from './lib/work-queue.mjs';

// ── CLI ───────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    preview:      { type: 'boolean', default: false },
    status:       { type: 'boolean', default: false },
    rescan:       { type: 'boolean', default: false },
    'retry-failed': { type: 'boolean', default: false },
    unit:         { type: 'string', short: 'u', default: '' },
    lesson:       { type: 'string', short: 'l', default: '' },
    help:         { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`Usage: node scripts/catch-up.mjs [options]

Options:
  --preview           Show what would be queued (no execution)
  --status            Show current queue status
  --rescan            Force re-scan calendar and rebuild queue
  --retry-failed      Reset all failed actions to pending
  --unit, -u          Process only this unit
  --lesson, -l        Process only this lesson (requires --unit)
  --help, -h          Show this help
`);
  process.exit(0);
}

// ── Status mode ───────────────────────────────────────────────────────────────

if (args.status) {
  const queue = loadQueue();
  const stats = computeStats(queue);
  console.log('');
  console.log('=== Catch-Up Queue Status ===');
  console.log('');
  console.log(`Last run: ${queue.lastRun || 'never'}`);
  console.log(`${formatStats(stats)}`);
  console.log('');

  // Show rate-limited actions with their retry times
  const rateLimited = queue.actions.filter(a => a.status === STATUS.rateLimited);
  if (rateLimited.length > 0) {
    console.log('Rate-limited (waiting for retry):');
    for (const a of rateLimited) {
      console.log(`  ${a.id} → retry after ${a.retryAfter}`);
    }
    console.log('');
  }

  // Show failed actions
  const failed = queue.actions.filter(a => a.status === STATUS.failed);
  if (failed.length > 0) {
    console.log('Failed (max retries reached):');
    for (const a of failed) {
      console.log(`  ${a.id} (${a.attempts} attempts) → ${a.lastError}`);
    }
    console.log('');
  }

  // Show next ready actions
  const ready = getReadyActions(queue);
  if (ready.length > 0) {
    console.log(`Next ready (${ready.length}):`);
    for (const a of ready.slice(0, 10)) {
      console.log(`  ${a.id}`);
    }
    if (ready.length > 10) console.log(`  ... and ${ready.length - 10} more`);
    console.log('');
  }

  process.exit(0);
}

// ── Retry-failed mode ─────────────────────────────────────────────────────────

if (args['retry-failed']) {
  const queue = loadQueue();
  const count = retryFailed(queue);
  computeStats(queue);
  saveQueue(queue);
  console.log(`Reset ${count} failed action(s) to pending.`);
  process.exit(0);
}

// ── Main flow ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('========================================');
  console.log('  Catch-Up Pipeline');
  console.log('========================================');
  console.log('');

  // Step 1: Scan calendar
  console.log('Scanning calendar...');
  let calendarLessons;

  if (args.unit && args.lesson) {
    // Single lesson mode — build a synthetic entry
    const unit = Number(args.unit);
    const lesson = Number(args.lesson);
    calendarLessons = [{
      date: new Date().toISOString().slice(0, 10),
      dayName: 'Manual',
      unit,
      lesson,
      periods: ['B', 'E'],
    }];
    console.log(`  Single lesson mode: ${unit}.${lesson}`);
  } else {
    calendarLessons = scanAllLessons();
    console.log(`  Found ${calendarLessons.length} lesson entries on calendar`);
  }

  if (calendarLessons.length === 0) {
    console.log('  No lessons found on calendar. Nothing to do.');
    return;
  }

  // Step 2: Diff against registry
  console.log('');
  console.log('Diffing against registry...');
  const { actions, summary } = diffLessons(calendarLessons);
  console.log(`  ${summary.lessonsOnCalendar} unique lessons`);
  console.log(`  ${summary.totalActions} total actions`);
  console.log(`  ${summary.alreadyDone} already done`);
  console.log(`  ${summary.toEnqueue} to enqueue`);

  // Step 3: Build/update queue
  console.log('');
  console.log('Updating work queue...');
  const queue = args.rescan ? { version: 1, lastRun: null, stats: {}, actions: [] } : loadQueue();

  let enqueued = 0;
  let preCompleted = 0;

  for (const action of actions) {
    if (action.alreadyComplete) {
      // Mark as completed in queue if not already there
      const existing = queue.actions.find(a => a.id === action.id);
      if (!existing) {
        enqueueAction(queue, action);
        markCompleted(queue, action.id);
        preCompleted++;
      } else if (existing.status !== STATUS.completed && existing.status !== STATUS.skipped) {
        markCompleted(queue, action.id);
        preCompleted++;
      }
    } else {
      if (enqueueAction(queue, action)) {
        enqueued++;
      }
    }
  }

  const stats = computeStats(queue);
  console.log(`  ${enqueued} new action(s) enqueued`);
  console.log(`  ${preCompleted} pre-completed from registry`);
  console.log(`  ${formatStats(stats)}`);

  queue.lastRun = new Date().toISOString();
  saveQueue(queue);

  // Preview mode: stop here
  if (args.preview) {
    console.log('');
    console.log('Preview mode — no actions executed.');
    const ready = getReadyActions(queue);
    if (ready.length > 0) {
      console.log('');
      console.log(`Ready to execute (${ready.length}):`);
      for (const a of ready) {
        console.log(`  ${a.id} (${a.type})`);
      }
    }
    return;
  }

  // Step 4: Process queue
  console.log('');
  console.log('Processing queue...');
  console.log('');

  let executed = 0;
  let succeeded = 0;
  let failed = 0;
  let rateLimited = 0;

  // Process in loops until no more ready actions
  while (true) {
    const ready = getReadyActions(queue);
    if (ready.length === 0) break;

    // Sort by date (earliest first), then by dependency depth
    ready.sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.dependsOn.length - b.dependsOn.length;
    });

    // Take the first ready action
    const action = ready[0];
    console.log(`[${executed + 1}] ${action.id} (${action.type})...`);

    markRunning(queue, action.id);
    saveQueue(queue);

    const result = await executeAction(action);

    if (result.success) {
      markCompleted(queue, action.id);
      console.log(`  [OK] Done.`);
      succeeded++;
    } else if (result.isRateLimit) {
      const backoff = getBackoffForAction(action.type);
      markRateLimited(queue, action.id, backoff);
      const hours = (backoff / 3600000).toFixed(1);
      console.log(`  [RATE LIMITED] Retry in ${hours}h. ${result.error}`);
      rateLimited++;
      // Stop processing — rate limit likely affects all subsequent actions of same type
      saveQueue(queue);
      break;
    } else if (result.missing) {
      // Script doesn't exist yet — skip, don't retry
      markSkipped(queue, action.id, result.error);
      console.log(`  [SKIP] ${result.error}`);
    } else {
      const backoff = getBackoffForAction(action.type);
      markFailed(queue, action.id, result.error, backoff);
      console.log(`  [FAIL] ${result.error}`);
      failed++;
    }

    saveQueue(queue);
    executed++;

    // Brief pause between actions
    await new Promise(r => setTimeout(r, 1000));
  }

  // Final summary
  const finalStats = computeStats(queue);
  console.log('');
  console.log('========================================');
  console.log('  Catch-Up Complete');
  console.log('========================================');
  console.log('');
  console.log(`This run: ${executed} executed, ${succeeded} OK, ${failed} failed, ${rateLimited} rate-limited`);
  console.log(`Queue: ${formatStats(finalStats)}`);

  const nextReady = getReadyActions(queue);
  if (nextReady.length > 0) {
    console.log(`\n${nextReady.length} action(s) ready on next run.`);
  }

  const nextRateLimited = queue.actions
    .filter(a => a.status === STATUS.rateLimited && a.retryAfter)
    .sort((a, b) => a.retryAfter.localeCompare(b.retryAfter));
  if (nextRateLimited.length > 0) {
    console.log(`\nNext retry: ${nextRateLimited[0].id} at ${nextRateLimited[0].retryAfter}`);
  }

  console.log('');
  saveQueue(queue);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
