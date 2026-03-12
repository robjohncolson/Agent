/**
 * registry-validator.mjs — Schema validation for lesson registry writes.
 *
 * Exports:
 *   validateMaterial(type, data) → { valid, errors }
 *   validateSchoologyState(state, period) → { valid, errors }
 *   validateRegistryEntry(entry) → { valid, errors }
 *   validateEntireRegistry(registry) → { valid, errors, errorCount }
 */

const DIGIT_STRING = /^\d+$/;
const HEX_12 = /^[0-9a-f]{12}$/;
const HTTPS_URL = /^https:\/\//;
const KEYED_TYPES = new Set(['worksheet', 'drills', 'quiz', 'blooket']);

export function validateMaterial(type, data) {
  const errors = [];

  if (data === null || data === undefined) {
    return { valid: true, errors }; // null is valid for "not yet created"
  }

  if (type === 'videos') {
    if (!Array.isArray(data)) {
      errors.push(`videos must be an array, got: ${typeof data}`);
      return { valid: false, errors };
    }
    for (let i = 0; i < data.length; i++) {
      const sub = validateMaterial(`videos[${i}]`, data[i]);
      if (!sub.valid) errors.push(...sub.errors.map(e => `videos[${i}]: ${e}`));
    }
    return { valid: errors.length === 0, errors };
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    errors.push(`${type} must be an object or null, got: ${typeof data}`);
    return { valid: false, errors };
  }

  // Field-level checks
  if ('schoologyId' in data && data.schoologyId !== null) {
    if (typeof data.schoologyId !== 'string' || !DIGIT_STRING.test(data.schoologyId)) {
      errors.push(`schoologyId must be a digit string or null, got: ${JSON.stringify(data.schoologyId)}`);
    }
  }

  if ('contentHash' in data && data.contentHash !== null && data.contentHash !== undefined) {
    if (typeof data.contentHash !== 'string' || !HEX_12.test(data.contentHash)) {
      errors.push(`contentHash must be 12 hex chars, got: ${JSON.stringify(data.contentHash)}`);
    }
  }

  if ('title' in data && data.title !== null) {
    if (typeof data.title !== 'string' || data.title.length === 0) {
      errors.push(`title must be a non-empty string or null, got: ${JSON.stringify(data.title)}`);
    }
  }

  if ('href' in data && data.href !== null) {
    if (typeof data.href !== 'string' || !HTTPS_URL.test(data.href)) {
      errors.push(`href must be an https URL or null, got: ${JSON.stringify(data.href)}`);
    }
  }

  if ('targetUrl' in data && data.targetUrl !== null) {
    if (typeof data.targetUrl !== 'string') {
      errors.push(`targetUrl must be a string or null, got: ${JSON.stringify(data.targetUrl)}`);
    }
  }

  if ('copiedFromId' in data && data.copiedFromId !== null && data.copiedFromId !== undefined) {
    if (typeof data.copiedFromId !== 'string' || !DIGIT_STRING.test(data.copiedFromId)) {
      errors.push(`copiedFromId must be a digit string, got: ${JSON.stringify(data.copiedFromId)}`);
    }
  }

  // Keyed material completeness: must have schoologyId, copiedFromId, or status
  if (KEYED_TYPES.has(type)) {
    const hasId = data.schoologyId || data.copiedFromId;
    const hasStatus = typeof data.status === 'string' && data.status.length > 0;
    if (!hasId && !hasStatus && Object.keys(data).length > 0) {
      errors.push(`${type} must have schoologyId, copiedFromId, or a status — got empty shell`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateSchoologyState(state, period) {
  const errors = [];
  if (!state || typeof state !== 'object') {
    errors.push(`schoology.${period} must be an object`);
    return { valid: false, errors };
  }

  if ('folderId' in state && state.folderId !== null) {
    if (typeof state.folderId !== 'string' || !DIGIT_STRING.test(state.folderId)) {
      errors.push(`folderId must be a digit string or null, got: ${JSON.stringify(state.folderId)}`);
    }
  }

  // Validate materials
  if (state.materials && typeof state.materials === 'object') {
    // Duplicate schoologyId check
    const seenIds = new Map(); // id → type
    const seenHashes = new Map(); // hash → type

    for (const [type, mat] of Object.entries(state.materials)) {
      if (type === 'videos' && Array.isArray(mat)) {
        for (const v of mat) {
          if (v?.schoologyId) {
            if (seenIds.has(v.schoologyId)) {
              errors.push(`duplicate schoologyId ${v.schoologyId} in videos and ${seenIds.get(v.schoologyId)}`);
            }
            seenIds.set(v.schoologyId, 'video');
          }
          if (v?.contentHash) {
            if (seenHashes.has(v.contentHash)) {
              errors.push(`duplicate contentHash ${v.contentHash} in videos and ${seenHashes.get(v.contentHash)}`);
            }
            seenHashes.set(v.contentHash, 'video');
          }
        }
      } else {
        if (mat?.schoologyId) {
          if (seenIds.has(mat.schoologyId)) {
            errors.push(`duplicate schoologyId ${mat.schoologyId} in ${type} and ${seenIds.get(mat.schoologyId)}`);
          }
          seenIds.set(mat.schoologyId, type);
        }
        if (mat?.contentHash) {
          if (seenHashes.has(mat.contentHash)) {
            errors.push(`duplicate contentHash ${mat.contentHash} in ${type} and ${seenHashes.get(mat.contentHash)}`);
          }
          seenHashes.set(mat.contentHash, type);
        }
      }
    }

    // Per-material validation
    for (const [type, mat] of Object.entries(state.materials)) {
      const sub = validateMaterial(type, mat);
      if (!sub.valid) errors.push(...sub.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateRegistryEntry(entry) {
  const errors = [];

  if (!entry || typeof entry !== 'object') {
    errors.push('entry must be an object');
    return { valid: false, errors };
  }

  if (!Number.isInteger(entry.unit) || entry.unit <= 0) {
    errors.push(`unit must be a positive integer, got: ${JSON.stringify(entry.unit)}`);
  }

  if (!Number.isInteger(entry.lesson) || entry.lesson <= 0) {
    errors.push(`lesson must be a positive integer, got: ${JSON.stringify(entry.lesson)}`);
  }

  // Validate schoology periods
  if (entry.schoology && typeof entry.schoology === 'object') {
    for (const period of ['B', 'E']) {
      if (entry.schoology[period]) {
        const sub = validateSchoologyState(entry.schoology[period], period);
        if (!sub.valid) {
          errors.push(...sub.errors.map(e => `${period}: ${e}`));
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateEntireRegistry(registry) {
  const allErrors = [];
  let errorCount = 0;

  if (!registry || typeof registry !== 'object') {
    return { valid: false, errors: [{ lesson: 'N/A', message: 'registry must be an object' }], errorCount: 1 };
  }

  for (const [key, entry] of Object.entries(registry)) {
    const result = validateRegistryEntry(entry);
    if (!result.valid) {
      for (const err of result.errors) {
        allErrors.push({ lesson: key, message: err });
        errorCount++;
      }
    }
  }

  return {
    valid: errorCount === 0,
    errors: allErrors,
    errorCount,
  };
}
