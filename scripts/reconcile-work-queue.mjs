#!/usr/bin/env node
/**
 * reconcile-work-queue.mjs — Reconcile work queue against registry state.
 * Marks actions as completed if the registry shows the work is already done.
 *
 * Usage:
 *   node scripts/reconcile-work-queue.mjs              # dry-run
 *   node scripts/reconcile-work-queue.mjs --execute     # apply changes
 *   node scripts/reconcile-work-queue.mjs --unit 6      # only unit 6
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT } from './lib/paths.mjs';
import { loadRegistry } from './lib/lesson-registry.mjs';

const execute = process.argv.includes('--execute');
const unitFilter = process.argv.includes('--unit')
  ? Number(process.argv[process.argv.indexOf('--unit') + 1])
  : null;

const queuePath = join(AGENT_ROOT, 'state', 'work-queue.json');
const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
const registry = loadRegistry();

let reconciled = 0;
let alreadyDone = 0;
let stillPending = 0;

for (const action of queue.actions) {
  if (action.status === 'completed') { alreadyDone++; continue; }
  if (unitFilter && action.unit !== unitFilter) continue;

  const key = `${action.unit}.${action.lesson}`;
  const entry = registry[key];
  if (!entry) continue;

  let isDone = false;
  const sch = entry.schoology || {};
  const bMats = sch.B?.materials || {};
  const eMats = sch.E?.materials || {};

  switch (action.type) {
    case 'ingest':
      // Done if entry has topic or date or any URLs
      isDone = !!(entry.topic || entry.date || entry.urls?.worksheet);
      break;

    case 'content-gen-worksheet':
      isDone = !!(entry.urls?.worksheet);
      break;

    case 'content-gen-blooket':
      isDone = !!(entry.urls?.blooket);
      break;

    case 'content-gen-drills':
      isDone = !!(entry.urls?.drills);
      break;

    case 'upload-blooket':
      isDone = !!(entry.urls?.blooket);
      break;

    case 'post-schoology-B':
      // Done if any keyed material has a schoologyId in B
      isDone = !!(bMats.worksheet?.schoologyId || bMats.drills?.schoologyId ||
                  bMats.quiz?.schoologyId || bMats.blooket?.schoologyId);
      break;

    case 'post-schoology-E':
      isDone = !!(eMats.worksheet?.schoologyId || eMats.drills?.schoologyId ||
                  eMats.quiz?.schoologyId || eMats.blooket?.schoologyId);
      break;

    case 'verify-schoology-B':
      isDone = !!(sch.B?.verifiedAt);
      break;

    case 'verify-schoology-E':
      isDone = !!(sch.E?.verifiedAt);
      break;

    case 'render-animations':
    case 'upload-animations':
      // Skip — complex pipeline, don't auto-reconcile
      break;

    default:
      break;
  }

  if (isDone) {
    console.log(`[DONE] ${action.id} — already complete per registry`);
    if (execute) {
      action.status = 'completed';
      action.completedAt = new Date().toISOString();
    }
    reconciled++;
  } else {
    stillPending++;
  }
}

if (execute && reconciled > 0) {
  // Update stats
  queue.stats.completed = queue.actions.filter(a => a.status === 'completed').length;
  queue.stats.pending = queue.actions.filter(a => a.status === 'pending').length;
  queue.stats.blocked = queue.actions.filter(a => a.status === 'blocked').length;
  writeFileSync(queuePath, JSON.stringify(queue, null, 2) + '\n');
  console.log(`\nSaved. Queue updated.`);
}

console.log(`\nSummary: ${reconciled} reconciled to completed, ${stillPending} still pending, ${alreadyDone} already done`);
if (!execute && reconciled > 0) console.log('Re-run with --execute to apply.');
