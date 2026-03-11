#!/usr/bin/env node

/**
 * migrate-registry-multi-period.mjs
 *
 * One-time migration script that converts existing flat `schoology` objects
 * in the lesson registry to the new per-period `{ B: {...} }` format.
 *
 * Usage:
 *   node scripts/migrate-registry-multi-period.mjs            # Preview (dry run)
 *   node scripts/migrate-registry-multi-period.mjs --execute   # Apply migration
 */

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT } from './lib/paths.mjs';
import { loadRegistry, saveRegistry } from './lib/lesson-registry.mjs';

// ── Detection heuristics ────────────────────────────────────────────────────

function isOldFormat(schoology) {
  if (!schoology || typeof schoology !== 'object') return false;
  // Old format has folderId at the top level
  return 'folderId' in schoology;
}

function isNewFormat(schoology) {
  if (!schoology || typeof schoology !== 'object') return false;
  // New format has single-letter keys (B, E) whose values are objects
  return Object.keys(schoology).some(k =>
    k.length === 1 && typeof schoology[k] === 'object' && schoology[k] !== null
  );
}

function isEmpty(schoology) {
  if (!schoology || typeof schoology !== 'object') return true;
  return Object.keys(schoology).length === 0;
}

// ── Main ────────────────────────────────────────────────────────────────────

const execute = process.argv.includes('--execute');

console.log('Multi-Period Registry Migration');
console.log('================================');
console.log();
console.log(execute ? 'EXECUTE mode — changes will be written' : 'Preview mode (use --execute to apply)');
console.log();

const registry = loadRegistry();
const keys = Object.keys(registry).sort((a, b) => {
  const [au, al] = a.split('.').map(Number);
  const [bu, bl] = b.split('.').map(Number);
  return au - bu || al - bl;
});

let migrated = 0;
let skipped = 0;
let errors = 0;

for (const key of keys) {
  const entry = registry[key];
  const schoology = entry.schoology;

  try {
    if (isEmpty(schoology)) {
      console.log(`[SKIP]    ${key}: schoology is empty`);
      skipped++;
    } else if (isNewFormat(schoology)) {
      console.log(`[SKIP]    ${key}: schoology already in new format`);
      skipped++;
    } else if (isOldFormat(schoology)) {
      const folderId = schoology.folderId ?? '(none)';
      console.log(`[MIGRATE] ${key}: wrapping flat schoology → { B: {...} }  (folderId: ${folderId})`);
      entry.schoology = { B: { ...schoology } };
      migrated++;
    } else {
      // Has keys but doesn't match old or new format — skip with note
      console.log(`[SKIP]    ${key}: schoology format unrecognized, leaving as-is`);
      skipped++;
    }
  } catch (err) {
    console.error(`[ERROR]   ${key}: ${err.message}`);
    errors++;
  }
}

console.log();
console.log(`Summary: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);

if (execute && migrated > 0) {
  // Back up current registry before writing
  const registryPath = join(AGENT_ROOT, 'state', 'lesson-registry.json');
  const backupPath = join(AGENT_ROOT, 'state', 'lesson-registry.pre-multiperiod.json');
  copyFileSync(registryPath, backupPath);
  console.log(`\nBackup saved to: ${backupPath}`);

  saveRegistry(registry);
  console.log('Migration applied successfully.');
} else if (execute && migrated === 0) {
  console.log('\nNo entries needed migration. Nothing written.');
} else if (!execute && migrated > 0) {
  console.log(`\nRe-run with --execute to apply ${migrated} migration(s).`);
}
