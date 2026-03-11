#!/usr/bin/env node
/**
 * schoology-deep-scrape.mjs — CDP-based recursive scraper that builds a
 * complete, normalized map of every folder and material in a Schoology course.
 *
 * Usage:
 *   node scripts/schoology-deep-scrape.mjs                           # Full scrape, Period B
 *   node scripts/schoology-deep-scrape.mjs --course E                # Period E
 *   node scripts/schoology-deep-scrape.mjs --folder 986721319        # Subtree only
 *   node scripts/schoology-deep-scrape.mjs --output custom-path.json # Custom output
 *
 * Prerequisites:
 *   npm install playwright
 *   Edge must be running with --remote-debugging-port=9222 (or start-edge-debug.cmd)
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { navigateToFolder, listItems, COURSE_IDS, materialsUrl, sleep } from './lib/schoology-dom.mjs';
import { parseTopicFromTitle, classifyMaterial } from './lib/schoology-classify.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const MAX_DEPTH = 10;
const NAV_DELAY_MS = 1500;

// ── CLI argument parsing ─────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    course:  { type: 'string',  short: 'c', default: 'B' },
    folder:  { type: 'string',  short: 'f', default: '' },
    output:  { type: 'string',  short: 'o', default: '' },
    help:    { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`Usage: node scripts/schoology-deep-scrape.mjs [options]

Options:
  --course, -c   Course period letter (B or E, default: B)
  --folder, -f   Start folder ID for subtree scrape (default: root)
  --output, -o   Output file path (default: state/schoology-tree.json)
  --help,   -h   Show this help message
`);
  process.exit(0);
}

const courseKey = args.course.toUpperCase();
const courseId = COURSE_IDS[courseKey];
if (!courseId) {
  console.error(`Unknown course "${args.course}". Valid: ${Object.keys(COURSE_IDS).join(', ')}`);
  process.exit(1);
}

const startFolderId = args.folder || null;
const outputPath = args.output
  ? resolve(process.cwd(), args.output)
  : resolve(REPO_ROOT, 'state', 'schoology-tree.json');

// ── Scraper state ────────────────────────────────────────────────────────────

const folders = {};
const materials = {};
let maxDepthSeen = 0;
let foldersScraped = 0;

// ── Recursive scraper ────────────────────────────────────────────────────────

/**
 * Recursively scrape a single folder level and all its child folders.
 *
 * @param {import('playwright').Page} page
 * @param {string} courseId
 * @param {string|null} folderId - Current folder ID (null = course root)
 * @param {string|null} parentId - Parent folder ID for the tree structure
 * @param {string[]} path - Breadcrumb path of folder names
 * @param {number} depth - Current depth (0 = root level)
 */
async function scrapeFolder(page, courseId, folderId, parentId, path, depth) {
  if (depth > MAX_DEPTH) {
    console.warn(`  WARNING: Max depth ${MAX_DEPTH} exceeded at path [${path.join(' > ')}]. Skipping subtree.`);
    return;
  }

  if (depth > maxDepthSeen) maxDepthSeen = depth;

  try {
    await navigateToFolder(page, courseId, folderId);
    await sleep(NAV_DELAY_MS);
  } catch (err) {
    console.warn(`  WARNING: Navigation to folder ${folderId} failed (${err.message}). Skipping subtree.`);
    return;
  }

  let items;
  try {
    items = await listItems(page);
  } catch (err) {
    console.warn(`  WARNING: listItems failed for folder ${folderId} (${err.message}). Skipping.`);
    return;
  }

  const pathLabel = path.length > 0 ? path.join('/') : '(root)';
  console.log(`Scraping folder: ${pathLabel} (depth ${depth}, ${items.length} items)...`);
  foldersScraped++;

  for (const item of items) {
    if (item.type === 'folder') {
      const childPath = [...path, item.name];

      folders[item.id] = {
        id: item.id,
        title: item.name,
        path: childPath,
        parentId: parentId,
        depth: depth,
        children: [],
        materials: [],
      };

      // Link child to parent
      if (parentId && folders[parentId]) {
        folders[parentId].children.push(item.id);
      }

      // Recurse into child folder
      await scrapeFolder(page, courseId, item.id, item.id, childPath, depth + 1);

      // Navigate back to current folder after returning from recursion
      try {
        await navigateToFolder(page, courseId, folderId);
        await sleep(NAV_DELAY_MS);
      } catch (err) {
        console.warn(`  WARNING: Failed to navigate back to folder ${folderId} after child ${item.id} (${err.message}).`);
      }
    } else {
      // Material (link, discussion, etc.)
      const parsed = parseTopicFromTitle(item.name);
      const matType = classifyMaterial(item.name);
      const matId = item.id;

      materials[matId] = {
        id: matId,
        title: item.name,
        type: item.type,
        href: item.href || materialsUrl(courseId, folderId),
        targetUrl: null,
        folderId: folderId || '__root__',
        folderPath: folderId ? [...path] : [],
        parsedLesson: parsed,
        parsedType: matType,
      };

      // Register material under its parent folder
      if (folderId && folders[folderId]) {
        folders[folderId].materials.push(matId);
      }
    }
  }
}

// ── Build lesson index ───────────────────────────────────────────────────────

function buildLessonIndex() {
  const lessonIndex = {};

  for (const [matId, mat] of Object.entries(materials)) {
    if (!mat.parsedLesson) continue;
    const key = `${mat.parsedLesson.unit}.${mat.parsedLesson.lesson}`;

    if (!lessonIndex[key]) {
      lessonIndex[key] = {
        folders: [],
        materials: [],
        primaryFolder: null,
        folderPath: null,
      };
    }

    lessonIndex[key].materials.push(matId);

    if (mat.folderId && mat.folderId !== '__root__' && !lessonIndex[key].folders.includes(mat.folderId)) {
      lessonIndex[key].folders.push(mat.folderId);
      if (!lessonIndex[key].primaryFolder) {
        lessonIndex[key].primaryFolder = mat.folderId;
        lessonIndex[key].folderPath = mat.folderPath;
      }
    }
  }

  return lessonIndex;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Schoology Deep Scraper`);
  console.log(`  Course: Period ${courseKey} (${courseId})`);
  console.log(`  Start:  ${startFolderId ? `folder ${startFolderId}` : 'course root'}`);
  console.log(`  Output: ${outputPath}`);
  console.log();

  // Dynamic import of playwright and CDP connector
  let chromium, connectCDP;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    console.error('Failed to import playwright. Install it with: npm install playwright');
    console.error(err.message);
    process.exit(1);
  }
  try {
    ({ connectCDP } = await import('./lib/cdp-connect.mjs'));
  } catch (err) {
    console.error('Failed to import cdp-connect.mjs:', err.message);
    process.exit(1);
  }

  let browser, page;
  try {
    ({ browser, page } = await connectCDP(chromium, { preferUrl: 'schoology.com' }));
  } catch (err) {
    console.error(`CDP connection failed: ${err.message}`);
    console.error('Make sure Edge is running with --remote-debugging-port=9222');
    process.exit(1);
  }

  const startTime = Date.now();

  // If starting from a subfolder, register it as the root entry
  if (startFolderId) {
    folders[startFolderId] = {
      id: startFolderId,
      title: '(start)',
      path: [],
      parentId: null,
      depth: 0,
      children: [],
      materials: [],
    };
  }

  try {
    await scrapeFolder(page, courseId, startFolderId, startFolderId, startFolderId ? [] : [], 0);
  } catch (err) {
    console.error(`\nFatal scrape error: ${err.message}`);
    console.error(err.stack);
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  // Build the lesson index
  const lessonIndex = buildLessonIndex();

  // Assemble output
  const output = {
    meta: {
      courseId,
      coursePeriod: courseKey,
      startFolderId: startFolderId || null,
      scrapedAt: new Date().toISOString(),
      elapsedSeconds: parseFloat(elapsedSec),
      totalFolders: Object.keys(folders).length,
      totalMaterials: Object.keys(materials).length,
      totalLessons: Object.keys(lessonIndex).length,
      maxDepth: maxDepthSeen,
    },
    folders,
    materials,
    lessonIndex,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

  // Print summary
  console.log();
  console.log(`=== Scrape Complete ===`);
  console.log(`  Folders scraped:  ${foldersScraped}`);
  console.log(`  Folder entries:   ${output.meta.totalFolders}`);
  console.log(`  Material entries: ${output.meta.totalMaterials}`);
  console.log(`  Lessons indexed:  ${output.meta.totalLessons}`);
  console.log(`  Max depth:        ${maxDepthSeen}`);
  console.log(`  Elapsed:          ${elapsedSec}s`);
  console.log(`  Output:           ${outputPath}`);
}

main().catch(err => {
  console.error(`Unhandled error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
