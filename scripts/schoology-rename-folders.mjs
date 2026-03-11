#!/usr/bin/env node
/**
 * schoology-rename-folders.mjs — Preview or apply Schoology folder name standardization.
 *
 * Loads the scraped tree, runs the folder-name standardizer, and prints a
 * rename plan.  With --execute it would apply renames via CDP (currently a
 * placeholder pending Schoology rename API research).
 *
 * Usage:
 *   node scripts/schoology-rename-folders.mjs                # Preview renames
 *   node scripts/schoology-rename-folders.mjs --execute      # Apply via CDP (TODO)
 *   node scripts/schoology-rename-folders.mjs --tree path    # Custom tree path
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AGENT_ROOT } from './lib/paths.mjs';
import { planFolderRenames } from './lib/folder-name-standardizer.mjs';

// ── CLI argument parsing ──────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    execute: { type: 'boolean', default: false },
    tree:    { type: 'string',  short: 't', default: '' },
    help:    { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Usage: node scripts/schoology-rename-folders.mjs [options]

Options:
  --execute     Apply renames via CDP (placeholder — not yet implemented)
  --tree PATH   Path to a custom schoology-tree.json
  -h, --help    Show this help message
`);
  process.exit(0);
}

// ── Load tree ─────────────────────────────────────────────────────────────────

const treePath = args.tree
  ? resolve(args.tree)
  : join(AGENT_ROOT, 'state', 'schoology-tree.json');

if (!existsSync(treePath)) {
  console.error(`[error] Tree file not found: ${treePath}`);
  console.error('Run the deep scraper first, or pass --tree to point at a different file.');
  process.exit(1);
}

let tree;
try {
  tree = JSON.parse(readFileSync(treePath, 'utf-8'));
} catch (err) {
  console.error(`[error] Failed to parse tree: ${err.message}`);
  process.exit(1);
}

// ── Plan renames ──────────────────────────────────────────────────────────────

const { renames, skipped } = planFolderRenames(tree);

// ── Print preview ─────────────────────────────────────────────────────────────

console.log('=== Schoology Folder Name Standardization ===\n');

if (renames.length === 0) {
  console.log('No renames needed — all day folders are already standardized (or unparseable).\n');
} else {
  console.log(`${renames.length} folder(s) to rename:\n`);

  // Find the longest old title for alignment
  const maxOld = Math.max(...renames.map(r => r.oldTitle.length));

  for (const r of renames) {
    const pad = ' '.repeat(maxOld - r.oldTitle.length);
    console.log(`  ${r.oldTitle}${pad}  →  ${r.newTitle}`);
  }
}

if (skipped.length > 0) {
  console.log(`\n${skipped.length} day-folder(s) skipped:`);
  for (const s of skipped) {
    console.log(`  [${s.reason}] ${s.title}`);
  }
}

// ── Execute mode ──────────────────────────────────────────────────────────────

const execute = args.execute;

if (execute) {
  console.log('\n[TODO] CDP-based rename not yet implemented.');
  console.log('Research needed: Schoology folder rename API or DOM method.');
  console.log('For now, use the preview output to manually rename folders.');
}

// ── Write log ─────────────────────────────────────────────────────────────────

const logPath = join(AGENT_ROOT, 'state', 'folder-rename-log.json');
const logEntry = {
  timestamp: new Date().toISOString(),
  treePath,
  executed: execute,
  totalRenames: renames.length,
  totalSkipped: skipped.length,
  renames,
  skipped,
};

let existingLog = [];
if (existsSync(logPath)) {
  try {
    existingLog = JSON.parse(readFileSync(logPath, 'utf-8'));
    if (!Array.isArray(existingLog)) existingLog = [existingLog];
  } catch {
    existingLog = [];
  }
}
existingLog.push(logEntry);
writeFileSync(logPath, JSON.stringify(existingLog, null, 2) + '\n');
console.log(`\nLog written to ${logPath}`);
