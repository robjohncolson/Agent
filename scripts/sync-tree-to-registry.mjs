#!/usr/bin/env node
/**
 * sync-tree-to-registry.mjs — Sync scraped tree into registry schoology[period].
 *
 * Two modes:
 *   --full     Replace entire schoology state per lesson (folder + materials)
 *   --ids-only (default) Only update stale material schoologyIds; preserve everything else
 *
 * Handles videos as arrays (not keyed singletons).
 *
 * Usage:
 *   node scripts/sync-tree-to-registry.mjs                    # Dry-run, IDs only
 *   node scripts/sync-tree-to-registry.mjs --execute           # Apply ID updates
 *   node scripts/sync-tree-to-registry.mjs --full --execute    # Full replace
 *   node scripts/sync-tree-to-registry.mjs --period E          # Custom period
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AGENT_ROOT } from './lib/paths.mjs';
import {
  loadRegistry,
  saveRegistry,
  setSchoologyState,
} from './lib/lesson-registry.mjs';
import { classifyMaterial } from './lib/schoology-classify.mjs';
import { COURSE_IDS } from './lib/schoology-dom.mjs';

// ── CLI ──────────────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);
let execute = false;
let fullMode = false;
let periodOverride = null;
let customTree = null;

for (let i = 0; i < cliArgs.length; i++) {
  switch (cliArgs[i]) {
    case '--execute': execute = true; break;
    case '--full': fullMode = true; break;
    case '--period': periodOverride = cliArgs[++i]?.toUpperCase(); break;
    case '--tree': customTree = resolve(cliArgs[++i]); break;
    case '--help': case '-h':
      console.log(`Usage: node scripts/sync-tree-to-registry.mjs [options]

Options:
  --execute      Apply changes (default: dry-run preview)
  --full         Replace entire schoology state (default: only update stale IDs)
  --period <P>   Override period (default: from tree metadata)
  --tree <path>  Custom tree path (default: state/schoology-tree.json)
  --help, -h     Show this help
`);
      process.exit(0);
  }
}

// ── Load data ────────────────────────────────────────────────────────────────

const treePath = customTree || join(AGENT_ROOT, 'state', 'schoology-tree.json');
const tree = JSON.parse(readFileSync(treePath, 'utf8'));
const period = periodOverride || tree.meta?.coursePeriod || 'B';
const courseId = COURSE_IDS[period];
const registry = loadRegistry();

console.log('');
console.log('=== Sync Tree → Registry ===');
console.log(`  Period:  ${period}`);
console.log(`  Mode:    ${fullMode ? 'FULL REPLACE' : 'IDs ONLY'}`);
console.log(`  Apply:   ${execute ? 'YES' : 'DRY-RUN'}`);
console.log(`  Scraped: ${tree.meta?.scrapedAt || 'unknown'}`);
console.log('');

// ── Parse tree materials per lesson ──────────────────────────────────────────

function buildTreeMaterials(lessonEntry) {
  const keyed = {};   // { worksheet: {...}, drills: {...} }
  const videos = [];  // [ {...}, {...} ]

  for (const matId of lessonEntry.materials || []) {
    const mat = tree.materials?.[matId];
    if (!mat) continue;

    const type = mat.parsedType || classifyMaterial(mat.title);
    if (type === 'unknown' || type === 'meta' || type === 'context') continue;

    const href = mat.href ||
      `https://lynnschools.schoology.com/course/${courseId}/materials/link/view/${matId}`;

    const entry = {
      schoologyId: matId,
      title: mat.title,
      href,
      targetUrl: mat.targetUrl || null,
    };

    if (type === 'video') {
      videos.push(entry);
    } else if (!keyed[type]) {
      keyed[type] = entry;
    }
  }

  return { keyed, videos };
}

// ── Full-replace mode ────────────────────────────────────────────────────────

if (fullMode) {
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
    const { keyed, videos } = buildTreeMaterials(entry);

    const materials = { ...keyed };
    if (videos.length > 0) materials.videos = videos;

    const matCount = Object.keys(keyed).length + videos.length;
    console.log(`[SYNC] ${key} → folder ${folderId} (${folderTitle || '?'})  [${matCount} mats]`);

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

  console.log(`\nDone: ${synced} synced, ${skipped} skipped`);
  if (!execute) console.log('Re-run with --execute to apply.');
  process.exit(0);
}

// ── IDs-only mode (default) ──────────────────────────────────────────────────

let updated = 0;
let added = 0;
let unchanged = 0;
const changes = [];

for (const [key, entry] of Object.entries(tree.lessonIndex || {})) {
  if (!registry[key]) continue;

  const regSch = registry[key].schoology?.[period];
  if (!regSch) continue;

  const regMats = regSch.materials || {};
  const { keyed: treeMats, videos: treeVids } = buildTreeMaterials(entry);
  let lessonChanged = false;

  // Keyed materials
  for (const type of ['worksheet', 'drills', 'quiz', 'blooket']) {
    const tm = treeMats[type];
    const rm = regMats[type];
    if (!tm) continue;

    if (!rm) {
      changes.push({ lesson: key, type, action: 'ADD', id: tm.schoologyId, title: tm.title });
      if (execute) {
        if (!regSch.materials) regSch.materials = {};
        regSch.materials[type] = tm;
      }
      added++;
      lessonChanged = true;
    } else if (rm.schoologyId !== tm.schoologyId) {
      changes.push({
        lesson: key, type, action: 'UPDATE',
        oldId: rm.schoologyId, newId: tm.schoologyId, title: tm.title,
      });
      if (execute) {
        regSch.materials[type] = {
          ...rm,           // preserve copiedFromId, status, etc.
          schoologyId: tm.schoologyId,
          title: tm.title,
          href: tm.href,
          targetUrl: tm.targetUrl,
          previousId: rm.schoologyId,
          syncedAt: new Date().toISOString(),
        };
      }
      updated++;
      lessonChanged = true;
    } else {
      unchanged++;
    }
  }

  // Videos array
  const regVids = Array.isArray(regMats.videos) ? regMats.videos : [];

  if (treeVids.length > 0) {
    const regVidIds = new Set(regVids.map(v => v.schoologyId).filter(Boolean));
    const treeVidIds = new Set(treeVids.map(v => v.schoologyId));
    const matchCount = regVids.filter(v => treeVidIds.has(v.schoologyId)).length;

    if (regVids.length > 0 && matchCount === 0) {
      // ALL registry video IDs are stale — replace with tree
      changes.push({
        lesson: key, type: 'videos', action: 'REPLACE',
        oldIds: regVids.map(v => v.schoologyId),
        newIds: treeVids.map(v => v.schoologyId),
        titles: treeVids.map(v => v.title),
      });
      if (execute) {
        regSch.materials.videos = treeVids.map(v => ({
          ...v,
          syncedAt: new Date().toISOString(),
        }));
      }
      updated += treeVids.length;
      lessonChanged = true;
    } else {
      // Add individually missing videos
      for (const tv of treeVids) {
        if (!regVidIds.has(tv.schoologyId)) {
          changes.push({
            lesson: key, type: 'video', action: 'ADD',
            id: tv.schoologyId, title: tv.title,
          });
          if (execute) {
            if (!Array.isArray(regSch.materials.videos)) regSch.materials.videos = [];
            regSch.materials.videos.push({ ...tv, syncedAt: new Date().toISOString() });
          }
          added++;
          lessonChanged = true;
        } else {
          unchanged++;
        }
      }
    }
  }

  if (lessonChanged && execute) {
    regSch.reconciledAt = new Date().toISOString();
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

if (changes.length === 0) {
  console.log('All registry material IDs match the tree — nothing to update.');
} else {
  console.log(`${changes.length} change(s) found:\n`);
  for (const c of changes) {
    if (c.action === 'UPDATE') {
      console.log(`  [UPDATE]  ${c.lesson} ${c.type}: ${c.oldId} → ${c.newId}`);
      console.log(`            "${c.title}"`);
    } else if (c.action === 'ADD') {
      console.log(`  [ADD]     ${c.lesson} ${c.type}: ${c.id}`);
      console.log(`            "${c.title}"`);
    } else if (c.action === 'REPLACE') {
      console.log(`  [REPLACE] ${c.lesson} videos: [${c.oldIds.join(', ')}] → [${c.newIds.join(', ')}]`);
      for (const t of c.titles) console.log(`            "${t}"`);
    }
  }
}

console.log('');
console.log(`Summary: ${updated} updated, ${added} new, ${unchanged} unchanged`);

if (execute && changes.length > 0) {
  saveRegistry(registry);
  console.log('Registry saved.');
} else if (!execute && changes.length > 0) {
  console.log('\nDry-run — use --execute to apply.');
}
console.log('');
