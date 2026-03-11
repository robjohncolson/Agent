/**
 * catch-up-diff.mjs — Diff calendar lessons against registry state
 * to produce a list of actions needed.
 *
 * For each lesson on the calendar, checks what's already done in the
 * registry and only enqueues missing work.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT } from './paths.mjs';
import { loadRegistry } from './lesson-registry.mjs';

// ── Artifact paths ────────────────────────────────────────────────────────────

const WORKSHEET_REPO = join(AGENT_ROOT, '..', 'apstats-live-worksheet');

function worksheetPath(unit, lesson) {
  return join(WORKSHEET_REPO, `u${unit}_lesson${lesson}_live.html`);
}

function blooketCsvPath(unit, lesson) {
  return join(WORKSHEET_REPO, `u${unit}_l${lesson}_blooket.csv`);
}

// ── Dependency graph template ─────────────────────────────────────────────────

/**
 * Build the dependency graph of actions for a single lesson.
 * Shared actions (ingest, content-gen, render, upload) are the same for both periods.
 * Per-period actions: post-schoology-{period}, verify-schoology-{period}.
 *
 * @param {number} unit
 * @param {number} lesson
 * @param {string[]} periods - ['B'], ['E'], or ['B', 'E']
 * @param {string} date - ISO date string for sorting
 * @returns {object[]} - Array of action descriptors with id, type, dependsOn
 */
function buildLessonActions(unit, lesson, periods, date) {
  const prefix = `${unit}.${lesson}`;
  const actions = [];

  // Shared actions (not period-specific)
  actions.push({
    id: `${prefix}-ingest`,
    unit, lesson, type: 'ingest',
    dependsOn: [],
    date,
  });

  actions.push({
    id: `${prefix}-content-gen-worksheet`,
    unit, lesson, type: 'content-gen-worksheet',
    dependsOn: [`${prefix}-ingest`],
    date,
  });

  actions.push({
    id: `${prefix}-content-gen-blooket`,
    unit, lesson, type: 'content-gen-blooket',
    dependsOn: [`${prefix}-ingest`],
    date,
  });

  actions.push({
    id: `${prefix}-content-gen-drills`,
    unit, lesson, type: 'content-gen-drills',
    dependsOn: [`${prefix}-ingest`],
    date,
  });

  actions.push({
    id: `${prefix}-render-animations`,
    unit, lesson, type: 'render-animations',
    dependsOn: [`${prefix}-content-gen-drills`],
    date,
  });

  actions.push({
    id: `${prefix}-upload-animations`,
    unit, lesson, type: 'upload-animations',
    dependsOn: [`${prefix}-render-animations`],
    date,
  });

  actions.push({
    id: `${prefix}-upload-blooket`,
    unit, lesson, type: 'upload-blooket',
    dependsOn: [`${prefix}-content-gen-blooket`],
    date,
  });

  // Per-period actions
  for (const period of periods) {
    // Period E copies from B (depends on B being posted first)
    // Period B depends on content being generated
    const postDeps = period === 'E'
      ? [`${prefix}-post-schoology-B`]
      : [`${prefix}-content-gen-worksheet`, `${prefix}-upload-blooket`];

    actions.push({
      id: `${prefix}-post-schoology-${period}`,
      unit, lesson, period, type: `post-schoology-${period}`,
      dependsOn: postDeps,
      date,
    });

    actions.push({
      id: `${prefix}-verify-schoology-${period}`,
      unit, lesson, period, type: `verify-schoology-${period}`,
      dependsOn: [`${prefix}-post-schoology-${period}`],
      date,
    });
  }

  return actions;
}

// ── Status checking ───────────────────────────────────────────────────────────

/**
 * Check if a specific action is already complete based on registry state.
 *
 * @param {string} actionType
 * @param {object} entry - Registry entry for this lesson
 * @param {number} unit
 * @param {number} lesson
 * @returns {boolean} true if action is already done
 */
function isActionComplete(actionType, entry, unit, lesson) {
  if (!entry) return false;

  const status = entry.status || {};
  const schoology = entry.schoology || {};

  switch (actionType) {
    case 'ingest':
      return status.ingest === 'done';

    case 'content-gen-worksheet':
      return status.worksheet === 'done' && existsSync(worksheetPath(unit, lesson));

    case 'content-gen-blooket':
      return status.blooketCsv === 'done' && existsSync(blooketCsvPath(unit, lesson));

    case 'content-gen-drills':
      return status.drills === 'done';

    case 'render-animations':
      return status.animations === 'done';

    case 'upload-animations':
      return status.animationUpload === 'done';

    case 'upload-blooket':
      return status.blooketUpload === 'done';

    case 'post-schoology-B':
      // Check if B has a folder and materials posted
      return status.schoology === 'done' && schoology.B?.folderId != null;

    case 'post-schoology-E': {
      // E is compliant when every material type in B also exists in E
      // (including videos). A folder existing from scrape isn't enough.
      if (!schoology.E?.folderId) return false;
      const eMats = schoology.E?.materials || {};
      const bMats = schoology.B?.materials || {};
      const bVids = Array.isArray(bMats.videos) ? bMats.videos : [];

      // If any B material is stale, E cannot be considered complete yet.
      for (const type of ['worksheet', 'drills', 'quiz', 'blooket']) {
        if (bMats[type]?.stale === true) return false;
      }
      if (bVids.some(v => v.stale === true)) return false;

      // Check keyed materials by content hash so re-posts still reconcile.
      for (const type of ['worksheet', 'drills', 'quiz', 'blooket']) {
        if (bMats[type]?.contentHash && !eMats[type]?.contentHash) return false;
      }

      // Check videos: every hashed B video should have a matching E hash.
      const eVids = Array.isArray(eMats.videos) ? eMats.videos : [];
      const eVidHashes = new Set(eVids.map(v => v.contentHash).filter(Boolean));
      for (const v of bVids) {
        if (v.contentHash && !eVidHashes.has(v.contentHash)) return false;
      }
      return true;
    }

    case 'verify-schoology-B':
      return status.schoologyVerified === 'done';

    case 'verify-schoology-E':
      // No separate verify status for E yet — check if E has reconciledAt
      return schoology.E?.reconciledAt != null;

    default:
      return false;
  }
}

// ── Main diff function ────────────────────────────────────────────────────────

/**
 * Diff calendar lessons against registry state.
 *
 * @param {object[]} calendarLessons - From scanCalendar():
 *   [{ date, dayName, unit, lesson, periods }]
 * @param {object} [registryOverride] - Optional registry to use (for testing)
 * @returns {{ actions: object[], summary: object }}
 */
export function diffLessons(calendarLessons, registryOverride) {
  const registry = registryOverride || loadRegistry();
  const allActions = [];
  let totalNeeded = 0;
  let alreadyDone = 0;

  // Deduplicate lessons: same (unit, lesson) may appear on multiple days
  // Merge periods and use earliest date
  const lessonMap = new Map();

  for (const entry of calendarLessons) {
    const key = `${entry.unit}.${entry.lesson}`;
    if (!lessonMap.has(key)) {
      lessonMap.set(key, {
        unit: entry.unit,
        lesson: entry.lesson,
        periods: new Set(entry.periods),
        date: entry.date,
      });
    } else {
      const existing = lessonMap.get(key);
      for (const p of entry.periods) existing.periods.add(p);
      // Use earliest date
      if (entry.date < existing.date) existing.date = entry.date;
    }
  }

  for (const [key, lesson] of lessonMap) {
    const regEntry = registry[key] || null;
    const periods = [...lesson.periods];
    const candidateActions = buildLessonActions(lesson.unit, lesson.lesson, periods, lesson.date);

    for (const action of candidateActions) {
      totalNeeded++;

      if (isActionComplete(action.type, regEntry, lesson.unit, lesson.lesson)) {
        alreadyDone++;
        // Still add as completed so dependency resolution works
        action.alreadyComplete = true;
      }

      allActions.push(action);
    }
  }

  return {
    actions: allActions,
    summary: {
      lessonsOnCalendar: lessonMap.size,
      totalActions: totalNeeded,
      alreadyDone,
      toEnqueue: totalNeeded - alreadyDone,
    },
  };
}
