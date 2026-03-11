#!/usr/bin/env node
/**
 * schoology-reconcile.mjs — CLI wrapper for Schoology-registry reconciliation.
 *
 * Loads the scraped Schoology tree and the lesson registry, runs reconciliation,
 * and prints a human-readable report. Supports --fix mode to auto-correct
 * registry drift where safe.
 *
 * Usage:
 *   node scripts/schoology-reconcile.mjs                            # Full reconciliation
 *   node scripts/schoology-reconcile.mjs --unit 6 --lesson 4        # Single lesson
 *   node scripts/schoology-reconcile.mjs --fix                      # Auto-fix registry from tree
 *   node scripts/schoology-reconcile.mjs --json                     # Raw JSON output
 *   node scripts/schoology-reconcile.mjs --tree state/custom.json   # Custom tree path
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AGENT_ROOT } from './lib/paths.mjs';
import {
  loadRegistry,
  updateUrl,
  updateStatus,
  setSchoologyState,
  getLesson,
  upsertLesson,
} from './lib/lesson-registry.mjs';
import {
  reconcile,
  reconcileLesson,
  validateFolderUrl,
  ISSUE_TYPES,
} from './lib/schoology-reconcile.mjs';

// ── CLI argument parsing ──────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    unit:   { type: 'string',  short: 'u', default: '' },
    lesson: { type: 'string',  short: 'l', default: '' },
    fix:    { type: 'boolean', default: false },
    json:   { type: 'boolean', default: false },
    tree:   { type: 'string',  short: 't', default: '' },
    help:   { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`Usage: node scripts/schoology-reconcile.mjs [options]

Options:
  --unit, -u     Unit number (use with --lesson for single-lesson mode)
  --lesson, -l   Lesson number (use with --unit for single-lesson mode)
  --fix          Auto-fix safe issues in the registry
  --json         Output raw JSON report (skip human-readable formatting)
  --tree, -t     Path to scraped tree JSON (default: state/schoology-tree.json)
  --help, -h     Show this help message
`);
  process.exit(0);
}

// ── Severity helpers ──────────────────────────────────────────────────────────

function severityLabel(severity) {
  switch (severity) {
    case 'error':   return '[ERROR]';
    case 'warning': return '[WARN] ';
    case 'info':    return '[INFO] ';
    default:        return '[????] ';
  }
}

function isError(severity) {
  return severity === 'error';
}

// ── Load data ─────────────────────────────────────────────────────────────────

const treePath = args.tree
  ? resolve(args.tree)
  : join(AGENT_ROOT, 'state', 'schoology-tree.json');

if (!existsSync(treePath)) {
  console.error(`Error: Tree file not found at ${treePath}`);
  console.error('Run `node scripts/schoology-deep-scrape.mjs` first');
  process.exit(1);
}

let tree;
try {
  tree = JSON.parse(readFileSync(treePath, 'utf8'));
} catch (err) {
  console.error(`Error: Failed to parse tree file: ${err.message}`);
  process.exit(1);
}

const registry = loadRegistry();

// ── Run reconciliation ────────────────────────────────────────────────────────

let report;
const singleMode = args.unit && args.lesson;

if (singleMode) {
  const unit = Number(args.unit);
  const lesson = Number(args.lesson);
  const key = `${unit}.${lesson}`;
  const entry = registry[key] || null;

  if (!entry) {
    console.error(`Error: No registry entry found for ${key}`);
    process.exit(1);
  }

  const result = reconcileLesson(unit, lesson, entry, tree);

  // Wrap single-lesson result in the same report shape as full reconcile
  report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalLessons: 1,
      fullyReconciled: result.status === 'reconciled' ? 1 : 0,
      withIssues: result.status === 'reconciled' ? 0 : 1,
      orphanedInSchoology: 0,
      missingFromSchoology: 0,
    },
    issues: result.issues,
    perLesson: { [key]: result },
  };
} else {
  report = reconcile(registry, tree);
}

// ── JSON output mode ──────────────────────────────────────────────────────────

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
  const hasErrors = report.issues.some(i => isError(i.severity));
  process.exit(hasErrors && !args.fix ? 1 : 0);
}

// ── Fix mode ──────────────────────────────────────────────────────────────────

const fixes = [];

if (args.fix) {
  for (const issue of report.issues) {
    const [unitStr, lessonStr] = issue.lesson.split('.');
    const unit = Number(unitStr);
    const lesson = Number(lessonStr);

    switch (issue.type) {
      case 'malformed_folder_url': {
        // Extract last f= value and clean the URL
        const entry = registry[issue.lesson];
        if (entry?.urls?.schoologyFolder) {
          const validation = validateFolderUrl(entry.urls.schoologyFolder);
          if (validation.folderId) {
            const baseUrl = entry.urls.schoologyFolder.split('?')[0];
            const cleanUrl = `${baseUrl}?f=${validation.folderId}`;
            updateUrl(unit, lesson, 'schoologyFolder', cleanUrl);
            fixes.push({
              lesson: issue.lesson,
              type: issue.type,
              message: `Updated schoologyFolder to ?f=${validation.folderId}`,
            });
          }
        }
        break;
      }

      case 'wrong_folder': {
        // Update folder URL to point to the actual folder
        const entry = registry[issue.lesson];
        if (issue.actualFolder) {
          const baseUrl = entry?.urls?.schoologyFolder
            ? entry.urls.schoologyFolder.split('?')[0]
            : '';
          if (baseUrl) {
            const fixedUrl = `${baseUrl}?f=${issue.actualFolder}`;
            updateUrl(unit, lesson, 'schoologyFolder', fixedUrl);
            fixes.push({
              lesson: issue.lesson,
              type: issue.type,
              message: `Updated schoologyFolder to ?f=${issue.actualFolder}`,
            });
          }

          // Also update schoology.folderPath if tree provides it
          if (issue.actualPath) {
            const currentState = getLesson(unit, lesson);
            const schoologyState = currentState?.schoology || {};
            setSchoologyState(unit, lesson, {
              ...schoologyState,
              folderId: issue.actualFolder,
              folderPath: issue.actualPath,
              reconciledAt: new Date().toISOString(),
            });
            fixes.push({
              lesson: issue.lesson,
              type: 'folder_path_updated',
              message: `Updated schoology.folderId and folderPath from tree`,
            });
          }
        }
        break;
      }

      case 'status_drift': {
        // Registry says pending but materials exist — mark as done
        if (issue.registryStatus === 'pending' && issue.actualMaterialCount > 0) {
          updateStatus(unit, lesson, 'schoology', 'done');
          fixes.push({
            lesson: issue.lesson,
            type: issue.type,
            message: `Updated status.schoology from "pending" to "done"`,
          });
        }
        break;
      }

      case 'folder_path_mismatch': {
        // Update folderPath to match tree
        if (issue.actualPath) {
          const currentState = getLesson(unit, lesson);
          const schoologyState = currentState?.schoology || {};
          setSchoologyState(unit, lesson, {
            ...schoologyState,
            folderPath: issue.actualPath,
            reconciledAt: new Date().toISOString(),
          });
          fixes.push({
            lesson: issue.lesson,
            type: issue.type,
            message: `Updated schoology.folderPath to [${issue.actualPath.join(' / ')}]`,
          });
        }
        break;
      }

      // Do NOT auto-fix these — they require human/CDP action
      case 'missing_from_schoology':
      case 'orphaned_at_root':
      case 'missing_material':
      case 'extra_material':
      case 'duplicate_materials':
      case 'url_target_mismatch':
        break;

      default:
        break;
    }
  }
}

// ── Human-readable report ─────────────────────────────────────────────────────

const { summary } = report;
const treeScrapedAt = tree.scrapedAt || tree.generatedAt || 'unknown';
const relTreePath = treePath.replace(/\\/g, '/');

console.log('');
console.log('========================================');
console.log('  Schoology-Registry Reconciliation');
console.log(`  Tree: ${relTreePath}`);
console.log(`  Scraped: ${treeScrapedAt}`);
console.log('========================================');
console.log('');
console.log(
  `Summary: ${summary.totalLessons} lessons, ` +
  `${summary.fullyReconciled} OK, ` +
  `${summary.withIssues} issues, ` +
  `${summary.orphanedInSchoology} orphans`
);
console.log('');

// Print issues grouped by severity
if (report.issues.length > 0) {
  // Sort: errors first, then warnings, then info
  const severityOrder = { error: 0, warning: 1, info: 2 };
  const sorted = [...report.issues].sort((a, b) => {
    const aOrd = severityOrder[a.severity] ?? 3;
    const bOrd = severityOrder[b.severity] ?? 3;
    if (aOrd !== bOrd) return aOrd - bOrd;
    return a.lesson.localeCompare(b.lesson, undefined, { numeric: true });
  });

  for (const issue of sorted) {
    const label = severityLabel(issue.severity);
    console.log(`${label} ${issue.lesson}: ${issue.type}`);
    console.log(`        ${issue.detail}`);

    // Extra context for specific issue types
    if (issue.type === 'wrong_folder') {
      console.log(`        Registry: f=${issue.registryFolder}  Actual: f=${issue.actualFolder}`);
      if (issue.actualPath) {
        console.log(`        Path: ${issue.actualPath.join(' / ')}`);
      }
    }

    if (issue.type === 'malformed_folder_url' && issue.url) {
      console.log(`        URL: ${issue.url}`);
    }

    if (issue.type === 'orphaned_at_root' && issue.orphanedMaterials) {
      console.log(`        ${issue.orphanedMaterials.length} material(s) at course root`);
    }

    console.log('');
  }
}

// Print fixes applied
if (fixes.length > 0) {
  console.log('--- Fixes Applied ---');
  console.log('');
  for (const fix of fixes) {
    console.log(`[FIX]   ${fix.lesson}: ${fix.message}`);
  }
  console.log('');
}

// Summary footer
const errorCount = report.issues.filter(i => i.severity === 'error').length;
const warnCount = report.issues.filter(i => i.severity === 'warning').length;
const infoCount = report.issues.filter(i => i.severity === 'info').length;

console.log('========================================');
if (report.issues.length === 0) {
  console.log('  All lessons reconciled successfully');
} else {
  const parts = [];
  if (errorCount > 0) parts.push(`${errorCount} error${errorCount !== 1 ? 's' : ''}`);
  if (warnCount > 0) parts.push(`${warnCount} warning${warnCount !== 1 ? 's' : ''}`);
  if (infoCount > 0) parts.push(`${infoCount} info`);
  console.log(`  ${report.issues.length} issues found (${parts.join(', ')})`);
  if (fixes.length > 0) {
    console.log(`  ${fixes.length} fix${fixes.length !== 1 ? 'es' : ''} applied`);
  }
}
console.log('========================================');
console.log('');

// ── Exit code ─────────────────────────────────────────────────────────────────

// After --fix, re-check: only exit 1 if unfixed errors remain
if (args.fix) {
  // Unfixable error types
  const unfixableErrors = report.issues.filter(i =>
    i.severity === 'error' &&
    !fixes.some(f => f.lesson === i.lesson && (
      f.type === i.type ||
      f.type === 'folder_path_updated'  // covers wrong_folder companion fix
    ))
  );
  process.exit(unfixableErrors.length > 0 ? 1 : 0);
} else {
  process.exit(errorCount > 0 ? 1 : 0);
}
