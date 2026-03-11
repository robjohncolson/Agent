/**
 * schoology-reconcile.mjs — Pure function library that compares registry state
 * against a scraped Schoology tree and produces a structured diff report.
 *
 * No CDP, no file I/O, no side effects. All functions take data as arguments
 * and return results.
 */

import { parseTopicFromTitle, classifyMaterial } from './schoology-classify.mjs';

// ── Issue type definitions ──────────────────────────────────────────────────

export const ISSUE_TYPES = {
  wrong_folder: 'error',
  orphaned_at_root: 'error',
  malformed_folder_url: 'warning',
  missing_from_schoology: 'error',
  missing_material: 'warning',
  extra_material: 'info',
  duplicate_materials: 'warning',
  folder_path_mismatch: 'warning',
  url_target_mismatch: 'error',
  stale_material: 'warning',
  status_drift: 'warning',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function lessonKey(unit, lesson) {
  return `${unit}.${lesson}`;
}

/**
 * Extract the set of expected material types from a registry entry's urls.
 * @param {object|null} entry - Registry entry
 * @returns {string[]} - e.g. ['worksheet', 'drills', 'quiz', 'blooket']
 */
function expectedMaterialTypes(entry) {
  if (!entry || !entry.urls) return [];
  const types = [];
  if (entry.urls.worksheet) types.push('worksheet');
  if (entry.urls.drills) types.push('drills');
  if (entry.urls.quiz) types.push('quiz');
  if (entry.urls.blooket) types.push('blooket');
  return types;
}

/**
 * Extract classified material types from an array of tree material objects.
 * @param {object[]} mats - Material objects from the tree
 * @param {object} tree - The full scraped tree (for resolving material IDs)
 * @returns {string[]} - Deduplicated list of parsed types
 */
function foundMaterialTypes(mats) {
  const types = new Set();
  for (const mat of mats) {
    const t = mat.parsedType;
    if (t && t !== 'unknown' && t !== 'meta' && t !== 'context') {
      types.add(t);
    }
  }
  return [...types];
}

// ── Exported Functions ──────────────────────────────────────────────────────

/**
 * Validate a Schoology folder URL.
 * @param {string} url
 * @returns {{ valid: boolean, folderId?: string, error?: string }}
 */
export function validateFolderUrl(url) {
  if (!url) {
    return { valid: false, error: 'empty' };
  }

  const str = String(url);

  // Check for double ?f= (malformed URL from stacked navigation)
  const fMatches = str.match(/[?&]f=(\d+)/g);
  if (fMatches && fMatches.length > 1) {
    // Extract the last f= value as the intended folder ID
    const lastMatch = fMatches[fMatches.length - 1];
    const lastFId = lastMatch.replace(/[?&]f=/, '');
    return { valid: false, error: 'malformed_double_f', folderId: lastFId };
  }

  // Check for a valid single f= param
  const singleF = str.match(/[?&]f=(\d+)/);
  if (singleF) {
    return { valid: true, folderId: singleF[1] };
  }

  // URL exists but has no f= param — could be a course root URL
  return { valid: false, error: 'no_folder_param' };
}

/**
 * Find all materials and folders for a lesson in the scraped tree.
 * @param {number} unit
 * @param {number} lesson
 * @param {object} tree - The scraped tree ({ folders, materials, lessonIndex })
 * @returns {{ folders: string[], materials: object[], primaryFolder: string|null, folderPath: string[]|null }}
 */
export function findLessonInTree(unit, lesson, tree) {
  const empty = { folders: [], materials: [], primaryFolder: null, folderPath: null };

  if (!tree || !tree.lessonIndex) return empty;

  const key = lessonKey(unit, lesson);
  const entry = tree.lessonIndex[key];

  if (!entry) return empty;

  // Resolve material IDs to full material objects
  const materialObjects = [];
  if (Array.isArray(entry.materials) && tree.materials) {
    for (const matId of entry.materials) {
      const mat = tree.materials[matId];
      if (mat) {
        materialObjects.push(mat);
      }
    }
  }

  return {
    folders: Array.isArray(entry.folders) ? [...entry.folders] : [],
    materials: materialObjects,
    primaryFolder: entry.primaryFolder || null,
    folderPath: entry.folderPath ? [...entry.folderPath] : null,
  };
}

/**
 * Reconcile a single lesson between registry and Schoology tree.
 * @param {number} unit
 * @param {number} lesson
 * @param {object} registryEntry - The registry entry for this lesson
 * @param {object} tree - The full scraped tree
 * @returns {{ status: string, issues: object[], registryFolder: string|null, schoologyFolder: string|null, folderPath: string[]|null, expectedMaterials: string[], foundMaterials: string[], missing: string[], extra: string[] }}
 */
export function reconcileLesson(unit, lesson, registryEntry, tree, period = 'B') {
  const key = lessonKey(unit, lesson);
  const issues = [];

  // Find what's in Schoology
  const inTree = findLessonInTree(unit, lesson, tree);

  // Determine which URL key to check based on period
  const folderUrlKey = period === 'E' ? 'schoologyFolderE' : 'schoologyFolder';

  // Determine registry folder ID
  let registryFolderId = null;
  const schoologyPeriod = registryEntry?.schoology?.[period];
  if (schoologyPeriod?.folderId) {
    registryFolderId = String(schoologyPeriod.folderId);
  } else if (registryEntry?.urls?.[folderUrlKey]) {
    const validation = validateFolderUrl(registryEntry.urls[folderUrlKey]);
    if (validation.folderId) {
      registryFolderId = validation.folderId;
    }
  }

  // 1. Folder URL validity check
  if (registryEntry?.urls?.[folderUrlKey]) {
    const validation = validateFolderUrl(registryEntry.urls[folderUrlKey]);
    if (!validation.valid) {
      issues.push({
        lesson: key,
        severity: ISSUE_TYPES.malformed_folder_url,
        type: 'malformed_folder_url',
        detail: `${folderUrlKey} URL is malformed: ${validation.error}`,
        url: registryEntry.urls[folderUrlKey],
      });
    }
  }

  // 2. Folder match: does registry's folder match ANY of the lesson's known folders?
  //    Lessons can span multiple folders (e.g., 6.6 across Monday + Tuesday).
  if (registryFolderId && inTree.folders.length > 0) {
    if (!inTree.folders.includes(registryFolderId)) {
      issues.push({
        lesson: key,
        severity: ISSUE_TYPES.wrong_folder,
        type: 'wrong_folder',
        detail: `Registry says folder ${registryFolderId} but materials found in folder ${inTree.primaryFolder}` +
          (inTree.folderPath ? ` (path: ${inTree.folderPath.join('/')})` : ''),
        registryFolder: registryFolderId,
        actualFolder: inTree.primaryFolder,
        actualPath: inTree.folderPath,
      });
    }
  }

  // 3. Folder path mismatch (folder exists in tree but path differs from registry)
  if (schoologyPeriod?.folderPath && inTree.folderPath) {
    const regPath = schoologyPeriod.folderPath;
    const treePath = inTree.folderPath;
    if (JSON.stringify(regPath) !== JSON.stringify(treePath)) {
      issues.push({
        lesson: key,
        severity: ISSUE_TYPES.folder_path_mismatch,
        type: 'folder_path_mismatch',
        detail: `Registry folder path [${regPath.join('/')}] differs from tree path [${treePath.join('/')}]`,
        registryPath: regPath,
        actualPath: treePath,
      });
    }
  }

  // 4. Orphan check: materials at course root for this lesson
  const orphanedAtRoot = inTree.materials.filter(
    m => m.folderId === '__root__' || m.folderId === null
  );
  if (orphanedAtRoot.length > 0) {
    issues.push({
      lesson: key,
      severity: ISSUE_TYPES.orphaned_at_root,
      type: 'orphaned_at_root',
      detail: `${orphanedAtRoot.length} material(s) found at course root level, expected in folder`,
      orphanedMaterials: orphanedAtRoot.map(m => m.id),
    });
  }

  // 5. Material presence comparison
  const expected = expectedMaterialTypes(registryEntry);
  const found = foundMaterialTypes(inTree.materials);

  const missing = expected.filter(t => !found.includes(t));
  const extra = found.filter(t => !expected.includes(t));

  for (const t of missing) {
    issues.push({
      lesson: key,
      severity: ISSUE_TYPES.missing_material,
      type: 'missing_material',
      detail: `Expected ${t} not found in Schoology`,
      materialType: t,
    });
  }

  for (const t of extra) {
    issues.push({
      lesson: key,
      severity: ISSUE_TYPES.extra_material,
      type: 'extra_material',
      detail: `Found ${t} in Schoology but not in registry urls`,
      materialType: t,
    });
  }

  // 6. Duplicate materials check (same type appears in multiple folders)
  const typeToFolders = {};
  for (const mat of inTree.materials) {
    const t = mat.parsedType;
    if (!t || t === 'unknown' || t === 'meta' || t === 'context') continue;
    if (!typeToFolders[t]) typeToFolders[t] = new Set();
    if (mat.folderId) typeToFolders[t].add(mat.folderId);
  }
  for (const [t, folderSet] of Object.entries(typeToFolders)) {
    if (folderSet.size > 1) {
      issues.push({
        lesson: key,
        severity: ISSUE_TYPES.duplicate_materials,
        type: 'duplicate_materials',
        detail: `${t} link exists in ${folderSet.size} folders`,
        materialType: t,
        duplicateLocations: [...folderSet],
      });
    }
  }

  // 7. Missing from Schoology entirely
  if (inTree.materials.length === 0 && registryEntry?.status?.schoology === 'done') {
    issues.push({
      lesson: key,
      severity: ISSUE_TYPES.missing_from_schoology,
      type: 'missing_from_schoology',
      detail: 'Registry has status.schoology=done but no materials found in Schoology',
      registryStatus: 'done',
    });
  }

  // 8. Status consistency (status drift)
  if (registryEntry?.status?.schoology) {
    const schoologyStatus = registryEntry.status.schoology;
    const hasMaterials = inTree.materials.length > 0;

    if (schoologyStatus === 'done' && !hasMaterials) {
      // Already covered by missing_from_schoology above, skip duplicate
    } else if (schoologyStatus === 'pending' && hasMaterials) {
      issues.push({
        lesson: key,
        severity: ISSUE_TYPES.status_drift,
        type: 'status_drift',
        detail: `Registry status.schoology is "pending" but ${inTree.materials.length} material(s) found in Schoology`,
        registryStatus: schoologyStatus,
        actualMaterialCount: inTree.materials.length,
      });
    }
  }

  // 9. URL target mismatch — compare registry URLs against scraped targetUrl
  if (registryEntry?.urls && inTree.materials.length > 0) {
    const urlTypeMap = {
      worksheet: registryEntry.urls.worksheet,
      drills: registryEntry.urls.drills,
      quiz: registryEntry.urls.quiz,
      blooket: registryEntry.urls.blooket,
    };

    for (const mat of inTree.materials) {
      const t = mat.parsedType;
      if (!t || !urlTypeMap[t] || !mat.targetUrl) continue;

      if (mat.targetUrl !== urlTypeMap[t]) {
        issues.push({
          lesson: key,
          severity: ISSUE_TYPES.url_target_mismatch,
          type: 'url_target_mismatch',
          detail: `Schoology ${t} link points to "${mat.targetUrl}" but registry has "${urlTypeMap[t]}"`,
          materialType: t,
          schoologyTarget: mat.targetUrl,
          registryTarget: urlTypeMap[t],
        });
      }
    }
  }

  // 10. Stale material check — materials marked stale by sync-tree
  if (schoologyPeriod?.materials) {
    for (const [type, mat] of Object.entries(schoologyPeriod.materials)) {
      if (type === 'videos' && Array.isArray(mat)) {
        for (const v of mat) {
          if (v?.stale === true) {
            issues.push({
              lesson: key,
              severity: ISSUE_TYPES.stale_material,
              type: 'stale_material',
              detail: `Video "${v.title}" (${v.schoologyId}) marked stale — not seen in last scrape`,
              materialType: 'video',
              schoologyId: v.schoologyId,
            });
          }
        }
      } else if (mat?.stale === true) {
        issues.push({
          lesson: key,
          severity: ISSUE_TYPES.stale_material,
          type: 'stale_material',
          detail: `${type} (${mat.schoologyId}) marked stale — not seen in last scrape`,
          materialType: type,
          schoologyId: mat.schoologyId,
        });
      }
    }
  }

  const status = issues.length === 0 ? 'reconciled' : 'issues';

  return {
    status,
    issues,
    registryFolder: registryFolderId,
    schoologyFolder: inTree.primaryFolder,
    folderPath: inTree.folderPath,
    expectedMaterials: expected,
    foundMaterials: found,
    missing,
    extra,
  };
}

/**
 * Find materials at the course root (folderId === '__root__' or null).
 * @param {object} tree - The scraped tree
 * @returns {{ materialId: string, title: string, parsedLesson: object|null, parsedType: string }[]}
 */
export function detectOrphans(tree) {
  if (!tree || !tree.materials) return [];

  const orphans = [];
  for (const [matId, mat] of Object.entries(tree.materials)) {
    if (mat.folderId === '__root__' || mat.folderId === null) {
      orphans.push({
        materialId: matId,
        title: mat.title || null,
        parsedLesson: mat.parsedLesson || null,
        parsedType: mat.parsedType || classifyMaterial(mat.title),
      });
    }
  }

  return orphans;
}

/**
 * Full reconciliation of all lessons in registry against tree.
 * @param {object} registry - The lesson registry (keyed by "unit.lesson")
 * @param {object} tree - The scraped Schoology tree
 * @returns {{ generatedAt: string, summary: object, issues: object[], perLesson: object }}
 */
export function reconcile(registry, tree, period = 'B') {
  const allIssues = [];
  const perLesson = {};
  let fullyReconciled = 0;
  let withIssues = 0;

  const registryObj = registry || {};
  const safeTree = tree || { folders: {}, materials: {}, lessonIndex: {} };

  // Iterate all registry entries
  for (const [key, entry] of Object.entries(registryObj)) {
    const unit = entry?.unit;
    const lesson = entry?.lesson;
    if (!unit || !lesson) continue;

    const result = reconcileLesson(unit, lesson, entry, safeTree, period);
    perLesson[key] = result;

    if (result.status === 'reconciled') {
      fullyReconciled++;
    } else {
      withIssues++;
    }

    allIssues.push(...result.issues);
  }

  // Detect orphans (materials at course root that belong to lessons)
  const orphans = detectOrphans(safeTree);
  const orphanedInSchoology = orphans.filter(o => o.parsedLesson != null).length;

  // Check for lessons in the tree but not in the registry
  let missingFromSchoology = 0;
  if (safeTree.lessonIndex) {
    for (const key of Object.keys(safeTree.lessonIndex)) {
      if (!registryObj[key]) {
        // Lesson exists in Schoology but not in registry — not an "issue" per se,
        // but tracked in the summary
        missingFromSchoology++;
      }
    }
  }

  const totalLessons = Object.keys(perLesson).length;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalLessons,
      fullyReconciled,
      withIssues,
      orphanedInSchoology,
      missingFromSchoology,
    },
    issues: allIssues,
    perLesson,
  };
}

export default {
  ISSUE_TYPES,
  validateFolderUrl,
  findLessonInTree,
  reconcileLesson,
  reconcile,
  detectOrphans,
};
