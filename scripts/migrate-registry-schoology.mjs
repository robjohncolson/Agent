#!/usr/bin/env node
/**
 * migrate-registry-schoology.mjs — Convert the three legacy Schoology
 * representations in the lesson registry into a single unified format.
 *
 * Usage:
 *   node scripts/migrate-registry-schoology.mjs              # Migrate in place
 *   node scripts/migrate-registry-schoology.mjs --dry-run    # Preview changes
 *   node scripts/migrate-registry-schoology.mjs --backup     # Save backup first
 */

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { loadRegistry, saveRegistry, REGISTRY_PATH } from './lib/lesson-registry.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BACKUP = args.includes('--backup');

// Inline classifier (no dependency on step 1)
function classifyMaterial(title) {
  if (!title) return 'unknown';
  const t = title.toLowerCase();
  if (/follow.?along|worksheet|wksheet/.test(t)) return 'worksheet';
  if (/drill/.test(t)) return 'drills';
  if (/math\s*practice\s*website/.test(t)) return 'drills';
  if (/blooket/.test(t)) return 'blooket';
  if (/quiz/.test(t)) return 'quiz';
  if (/video|vid\b|apclassroom/.test(t)) return 'video';
  if (/context/.test(t)) return 'context';
  if (/poster|gallery|calendar|trading|join\s*code/.test(t)) return 'meta';
  return 'unknown';
}

/**
 * Extract folder ID from a schoologyFolder URL.
 * Handles malformed double-?f= URLs by taking the last f= value.
 * Returns { folderId, cleanUrl, wasMalformed }.
 */
function extractFolderId(url) {
  if (!url || typeof url !== 'string') return { folderId: null, cleanUrl: null, wasMalformed: false };

  const fMatches = url.match(/[?&]f=(\d+)/g);
  if (!fMatches || fMatches.length === 0) return { folderId: null, cleanUrl: url, wasMalformed: false };

  const wasMalformed = fMatches.length > 1;
  const lastF = fMatches[fMatches.length - 1].replace(/[?&]f=/, '');
  const baseUrl = url.split('?')[0];
  const cleanUrl = `${baseUrl}?f=${lastF}`;

  return { folderId: lastF, cleanUrl, wasMalformed };
}

/**
 * Extract schoologyId from a Schoology material URL.
 * Handles both /link/view/ID and ?nid=ID patterns.
 */
function extractSchoologyId(href) {
  if (!href || typeof href !== 'string') return null;
  // /link/view/8285243425 or /materials/link/view/8285243425
  const viewMatch = href.match(/\/view\/(\d+)/);
  if (viewMatch) return viewMatch[1];
  // ?nid=8053341874
  const nidMatch = href.match(/[?&]nid=(\d+)/);
  if (nidMatch) return nidMatch[1];
  return null;
}

function migrateEntry(key, entry) {
  const warnings = [];
  const changes = [];

  // 1. Extract folderId from urls.schoologyFolder
  const folderUrl = entry.urls?.schoologyFolder ?? null;
  const { folderId, cleanUrl, wasMalformed } = extractFolderId(folderUrl);

  if (wasMalformed) {
    warnings.push(`Malformed folder URL fixed: ${folderUrl} → ${cleanUrl}`);
    changes.push('fixed_folder_url');
  }

  // 2. Build unified materials object
  const materials = {
    worksheet: null,
    drills: null,
    quiz: null,
    blooket: null,
    videos: [],
  };

  const oldSchoolgy = entry.schoology;
  const oldLinks = entry.schoologyLinks;

  // Layer 1: schoology.materials[] array (lowest priority)
  if (oldSchoolgy && Array.isArray(oldSchoolgy.materials)) {
    for (const mat of oldSchoolgy.materials) {
      // Use stored type first, fall back to classifier
      const type = mat.type || classifyMaterial(mat.title);
      const matData = {
        schoologyId: mat.schoologyId || null,
        title: mat.title || null,
        href: mat.href || null,
        targetUrl: null,
      };

      if (type === 'video') {
        materials.videos.push(matData);
      } else if (['worksheet', 'drills', 'quiz', 'blooket'].includes(type)) {
        if (!materials[type]) {
          materials[type] = matData;
        }
      }
      // context, meta, unknown — skip (not part of unified schema)
    }
    changes.push('migrated_materials_array');
  }

  // Layer 2: schoology.schoologyWorksheet/Drills/Quiz/Blooket/Videos URLs
  if (oldSchoolgy) {
    const urlMap = {
      worksheet: oldSchoolgy.schoologyWorksheet,
      drills: oldSchoolgy.schoologyDrills,
      quiz: oldSchoolgy.schoologyQuiz,
      blooket: oldSchoolgy.schoologyBlooket,
    };

    for (const [type, href] of Object.entries(urlMap)) {
      if (!href) continue;
      const schoologyId = extractSchoologyId(href);
      if (materials[type]) {
        // Merge into existing
        if (schoologyId && !materials[type].schoologyId) materials[type].schoologyId = schoologyId;
        if (!materials[type].href) materials[type].href = href;
      } else {
        materials[type] = { schoologyId, title: null, href, targetUrl: null };
      }
    }

    if (Array.isArray(oldSchoolgy.schoologyVideos)) {
      for (const href of oldSchoolgy.schoologyVideos) {
        const schoologyId = extractSchoologyId(href);
        const existing = materials.videos.find(v => v.schoologyId === schoologyId);
        if (!existing) {
          materials.videos.push({ schoologyId, title: null, href, targetUrl: null });
        } else if (!existing.href) {
          existing.href = href;
        }
      }
    }

    changes.push('merged_schoology_urls');
  }

  // Layer 3: schoologyLinks.* (highest priority)
  if (oldLinks && typeof oldLinks === 'object') {
    for (const [type, linkData] of Object.entries(oldLinks)) {
      if (!linkData || typeof linkData !== 'object') continue;
      if (!['worksheet', 'drills', 'quiz', 'blooket'].includes(type)) continue;

      const merged = materials[type] || { schoologyId: null, title: null, href: null, targetUrl: null };
      if (linkData.title) merged.title = linkData.title;
      if (linkData.status) merged.status = linkData.status;
      if (linkData.postedAt) merged.postedAt = linkData.postedAt;
      if (linkData.verified !== undefined) merged.verified = linkData.verified;
      if (linkData.error) merged.error = linkData.error;
      if (linkData.attemptedAt) merged.attemptedAt = linkData.attemptedAt;
      materials[type] = merged;
    }
    changes.push('merged_schoology_links');
  }

  // 3. Extract folderTitle
  let folderTitle = null;
  if (oldSchoolgy && Array.isArray(oldSchoolgy.dayFolders) && oldSchoolgy.dayFolders.length > 0) {
    folderTitle = oldSchoolgy.dayFolders[0];
  }

  // 4. Build unified schoology object
  const unified = {
    folderId: folderId || (oldSchoolgy && Array.isArray(oldSchoolgy.folderIds) && oldSchoolgy.folderIds[0]) || null,
    folderPath: null,
    folderTitle,
    verifiedAt: null,
    reconciledAt: null,
    materials,
  };

  // 5. Build migrated entry
  const migrated = { ...entry };

  // Clean folder URL
  if (wasMalformed && cleanUrl) {
    migrated.urls = { ...migrated.urls, schoologyFolder: cleanUrl };
  }

  // Set unified schoology, removing old format
  migrated.schoology = unified;

  // Remove deprecated schoologyLinks
  delete migrated.schoologyLinks;

  return { migrated, changes, warnings };
}

// --- Main ---

console.log('=== Schoology Registry Migration ===\n');

if (BACKUP) {
  const backupPath = REGISTRY_PATH.replace('.json', '.backup.json');
  copyFileSync(REGISTRY_PATH, backupPath);
  console.log(`Backup saved to: ${backupPath}\n`);
}

const registry = loadRegistry();
const keys = Object.keys(registry);

let migrated = 0;
let skipped = 0;
let urlsFixed = 0;
let allWarnings = [];

const migratedRegistry = {};

for (const key of keys) {
  const entry = registry[key];

  // Check if entry has any schoology data to migrate
  const hasOldSchoolgy = entry.schoology && (
    Array.isArray(entry.schoology.materials) ||
    entry.schoology.schoologyWorksheet ||
    entry.schoology.folderIds
  );
  const hasLinks = !!entry.schoologyLinks;
  const hasFolderUrl = !!entry.urls?.schoologyFolder;

  if (!hasOldSchoolgy && !hasLinks && !hasFolderUrl) {
    migratedRegistry[key] = entry;
    skipped++;
    continue;
  }

  const { migrated: migratedEntry, changes, warnings } = migrateEntry(key, entry);
  migratedRegistry[key] = migratedEntry;
  migrated++;

  if (warnings.length > 0) {
    allWarnings.push(...warnings.map(w => `  ${key}: ${w}`));
    urlsFixed += warnings.filter(w => w.includes('Malformed')).length;
  }

  const changeStr = changes.join(', ');
  console.log(`  [MIG] ${key}: ${changeStr}`);
}

console.log(`\n--- Migration Summary ---`);
console.log(`  Total entries:    ${keys.length}`);
console.log(`  Migrated:         ${migrated}`);
console.log(`  Skipped (no data): ${skipped}`);
console.log(`  URLs fixed:       ${urlsFixed}`);

if (allWarnings.length > 0) {
  console.log(`\n--- Warnings ---`);
  for (const w of allWarnings) console.log(w);
}

if (DRY_RUN) {
  console.log(`\n[DRY RUN] No changes written.`);
} else {
  saveRegistry(migratedRegistry);
  console.log(`\n✓ Registry migrated successfully.`);
}
