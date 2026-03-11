#!/usr/bin/env node
/**
 * sync-tree-to-registry.mjs — Sync scraped tree lessonIndex into registry schoology[period].
 *
 * Populates schoology.E (or B) folder IDs, paths, and materials from the tree.
 *
 * Usage:
 *   node scripts/sync-tree-to-registry.mjs           # Preview
 *   node scripts/sync-tree-to-registry.mjs --execute  # Apply
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT } from './lib/paths.mjs';
import { loadRegistry, setSchoologyState } from './lib/lesson-registry.mjs';

const args = process.argv.slice(2);
const execute = args.includes('--execute');

const treePath = join(AGENT_ROOT, 'state', 'schoology-tree.json');
const tree = JSON.parse(readFileSync(treePath, 'utf8'));
const period = tree.meta?.coursePeriod || 'B';
const registry = loadRegistry();

console.log(`Syncing tree lessonIndex → registry schoology.${period}`);
console.log(`Lessons in tree: ${Object.keys(tree.lessonIndex || {}).length}`);
console.log(`Mode: ${execute ? 'EXECUTE' : 'PREVIEW'}`);
console.log();

let synced = 0;
let skipped = 0;

for (const [key, entry] of Object.entries(tree.lessonIndex || {})) {
  const [unit, lesson] = key.split('.').map(Number);
  if (!registry[key]) {
    console.log(`[SKIP] ${key} — not in registry`);
    skipped++;
    continue;
  }

  const folderId = entry.primaryFolder || null;
  const folderPath = entry.folderPath || null;
  const folderTitle = (folderId && tree.folders?.[folderId]?.title) || null;

  // Collect materials from tree
  const materials = {};
  if (Array.isArray(entry.materials)) {
    for (const matId of entry.materials) {
      const mat = tree.materials?.[matId];
      if (mat?.parsedType && mat.parsedType !== 'unknown') {
        materials[mat.parsedType] = {
          schoologyId: matId,
          title: mat.title,
          href: mat.href || null,
          targetUrl: mat.targetUrl || null,
        };
      }
    }
  }

  const matCount = Object.keys(materials).length;
  console.log(`[SYNC] ${key} → folder ${folderId} (${folderTitle || 'unknown'})  [${matCount} materials]`);

  if (execute) {
    setSchoologyState(unit, lesson, {
      folderId,
      folderPath,
      folderTitle,
      verifiedAt: null,
      reconciledAt: new Date().toISOString(),
      materials,
    }, period);
  }

  synced++;
}

console.log();
console.log(`Done: ${synced} synced, ${skipped} skipped`);
if (!execute) {
  console.log(`\nRe-run with --execute to apply.`);
}
