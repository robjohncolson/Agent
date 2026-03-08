#!/usr/bin/env node
// Sync Schoology materials → lesson registry
// Parses state/schoology-materials.json, extracts topic/unit.lesson from titles,
// upserts into the lesson registry with Schoology URLs and folder info.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadRegistry, upsertLesson, saveRegistry } from './lib/lesson-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRAPE_PATH = resolve(__dirname, '..', 'state', 'schoology-materials.json');
const COURSE_ID = '7945275782';
const COURSE_BASE = `https://lynnschools.schoology.com/course/${COURSE_ID}`;

// --- Title parsing ---

// Match "Topic X.Y" or "X.Y" or "X-Y" patterns in titles
// Examples:
//   "Topic 6.10 — Follow-Along Worksheet" → {unit:6, lesson:10}
//   "apstats 5-7 blooket" → {unit:5, lesson:7}
//   "Quiz 6.9" → {unit:6, lesson:9} (this is the quiz FOR 6.9, assigned the day after)
//   "u2l7 blooket" → {unit:2, lesson:7}
//   "Unit 1 Lesson 8 video" → {unit:1, lesson:8}
//   "apclassroom video 6-2-1" → {unit:6, lesson:2}
//   "unit 4 L{10,11,12} blooket" → skip (multi-lesson)
function parseTopicFromTitle(title) {
  if (!title) return null;
  const t = title.trim();

  // Skip multi-lesson titles like "L{10,11,12}" or "lessons 3,4,5"
  if (/\{.*,.*\}/.test(t) || /lessons?\s+\d+\s*,\s*\d+/i.test(t)) return null;
  // Skip "l1 l2" style multi-lessons
  if (/l\d+\s*,?\s*l\d+/i.test(t)) return null;
  // Skip compound references like "6-1,2" or "l1&2"
  if (/\d+[,&]\d+/.test(t)) return null;

  // "Topic X.Y" — strongest signal
  let m = t.match(/Topic\s+(\d+)\.(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "Quiz X.Y" — the quiz tests topic X.Y
  m = t.match(/Quiz\s+(\d+)\.(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2], isQuiz: true };

  // "quiz X-Y"
  m = t.match(/quiz\s+(\d+)-(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2], isQuiz: true };

  // "Unit X Lesson Y" style
  m = t.match(/Unit\s*(\d+)\s*(?:Lesson|L)\s*(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "uXlY" style (e.g., "u2l7")
  m = t.match(/u(\d+)\s*l(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "apstats X-Y" or "apstat X-Y" (e.g., "apstats 5-7 blooket")
  m = t.match(/apstats?\s+(\d+)-(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "apclassroom video X-Y" (e.g., "apclassroom video 6-2-1" → 6.2)
  m = t.match(/apclassroom\s+video\s+(\d+)-(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "X-Y follow along" or "X-Y drills" or "X-Y blooket" (loose)
  m = t.match(/(\d+)-(\d+)\s+(?:follow|drill|blooket|vid)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "X.Y" bare (e.g., in folder descriptions like "6.6 Concluding a Test")
  m = t.match(/^(\d+)\.(\d+)\b/);
  if (m) return { unit: +m[1], lesson: +m[2] };

  return null;
}

// Classify material type from title
function classifyMaterial(title) {
  if (!title) return 'unknown';
  const t = title.toLowerCase();

  if (/follow.?along|worksheet|wksheet/.test(t)) return 'worksheet';
  if (/drill/.test(t)) return 'drills';
  if (/blooket/.test(t)) return 'blooket';
  if (/quiz/.test(t)) return 'quiz';
  if (/video|vid\b/.test(t)) return 'video';
  if (/math\s*practice\s*website/.test(t)) return 'drills'; // MPW hosts drills
  if (/context/.test(t)) return 'context';
  if (/poster|gallery|calendar|trading|join\s*code/.test(t)) return 'meta';
  return 'unknown';
}

// --- Tree traversal ---

// Collect all materials with their folder path context
function flattenTree(items, path = [], parentFolderId = null) {
  const result = [];

  for (const item of items) {
    if (item.type === 'folder') {
      const folderPath = [...path, { title: item.title, id: item.id, description: item.description }];
      // Also try to parse topic from folder description (day folders often have "6.6 Concluding a Test")
      if (item.children) {
        result.push(...flattenTree(item.children, folderPath, item.id));
      }
    } else if (item.type === 'material') {
      result.push({
        ...item,
        folderPath: path,
        parentFolderId
      });
    }
  }

  return result;
}

// --- Main ---

const scrapeData = JSON.parse(readFileSync(SCRAPE_PATH, 'utf-8'));
const allMaterials = flattenTree(scrapeData.tree);

console.log(`Loaded ${allMaterials.length} materials from Schoology scrape\n`);

// Group materials by unit.lesson
const byLesson = new Map(); // key: "U.L" → { materials: [...], folderIds: Set, dayFolders: [...] }

for (const mat of allMaterials) {
  const parsed = parseTopicFromTitle(mat.title);
  if (!parsed) continue;

  const key = `${parsed.unit}.${parsed.lesson}`;
  if (!byLesson.has(key)) {
    byLesson.set(key, {
      unit: parsed.unit,
      lesson: parsed.lesson,
      materials: [],
      folderIds: new Set(),
      dayFolderTitles: new Set()
    });
  }

  const entry = byLesson.get(key);
  const type = classifyMaterial(mat.title);

  entry.materials.push({
    title: mat.title,
    type,
    isQuiz: parsed.isQuiz || false,
    schoologyId: mat.schoologyId,
    href: mat.href,
    materialType: mat.materialType
  });

  // Track the parent folder (day folder)
  if (mat.parentFolderId) {
    entry.folderIds.add(mat.parentFolderId);
  }
  const dayFolder = mat.folderPath?.[mat.folderPath.length - 1];
  if (dayFolder) {
    entry.dayFolderTitles.add(dayFolder.title);
  }
}

// Sort by unit.lesson
const sortedKeys = [...byLesson.keys()].sort((a, b) => {
  const [au, al] = a.split('.').map(Number);
  const [bu, bl] = b.split('.').map(Number);
  return au - bu || al - bl;
});

console.log(`Found ${sortedKeys.length} unique lessons in Schoology\n`);

// Build registry updates
const registry = loadRegistry();
let created = 0, updated = 0, skipped = 0;

for (const key of sortedKeys) {
  const data = byLesson.get(key);
  const { unit, lesson, materials } = data;

  // Build Schoology URLs object
  const schoologyUrls = {};
  const videos = [];

  for (const mat of materials) {
    if (mat.type === 'worksheet' && !schoologyUrls.worksheet) {
      schoologyUrls.schoologyWorksheet = mat.href;
    } else if (mat.type === 'drills' && !schoologyUrls.drills) {
      schoologyUrls.schoologyDrills = mat.href;
    } else if (mat.type === 'blooket' && !schoologyUrls.blooket) {
      schoologyUrls.schoologyBlooket = mat.href;
    } else if (mat.type === 'quiz') {
      schoologyUrls.schoologyQuiz = mat.href;
    } else if (mat.type === 'video') {
      videos.push(mat.href);
    }
  }

  // Determine Schoology folder URL
  const folderIds = [...data.folderIds];
  const schoologyFolder = folderIds.length > 0
    ? `${COURSE_BASE}/materials?f=${folderIds[0]}`
    : null;

  // Build the patch
  const patch = {
    topic: `Topic ${unit}.${lesson}`,
    urls: {
      schoologyFolder
    },
    schoology: {
      materials: materials.map(m => ({
        title: m.title,
        type: m.type,
        schoologyId: m.schoologyId,
        href: m.href
      })),
      folderIds,
      dayFolders: [...data.dayFolderTitles],
      ...schoologyUrls,
      schoologyVideos: videos
    }
  };

  // Check if this lesson already has a "schoology" status of "done" from the pipeline
  const existing = registry[key];
  const isNew = !existing;

  // For lessons that were posted by the pipeline (status.schoology === "done"),
  // mark them as "scraped" to indicate the Schoology data was backfilled
  if (isNew) {
    // New lesson — create with status scraped
    patch.status = {
      schoology: 'scraped'
    };
    created++;
  } else {
    updated++;
  }

  // Upsert
  upsertLesson(unit, lesson, patch);

  const matSummary = materials.map(m => m.type).join(', ');
  const tag = isNew ? 'NEW' : 'UPD';
  console.log(`  [${tag}] ${key}: ${materials.length} materials (${matSummary})`);
}

console.log(`\n✓ Registry sync complete: ${created} created, ${updated} updated, ${skipped} skipped`);
console.log(`  Total lessons in registry: ${Object.keys(loadRegistry()).length}`);

// Summary of what's covered
console.log('\n=== Coverage Summary ===');
const finalRegistry = loadRegistry();
const allKeys = Object.keys(finalRegistry).sort((a, b) => {
  const [au, al] = a.split('.').map(Number);
  const [bu, bl] = b.split('.').map(Number);
  return au - bu || al - bl;
});

for (const k of allKeys) {
  const entry = finalRegistry[k];
  const hasPipeline = entry.status?.schoology === 'done';
  const hasScraped = !!entry.schoology?.materials?.length;
  const matCount = entry.schoology?.materials?.length || 0;
  const source = hasPipeline ? 'pipeline+scraped' : hasScraped ? 'scraped' : 'pipeline-only';
  console.log(`  ${k}: ${source} (${matCount} Schoology materials)`);
}
