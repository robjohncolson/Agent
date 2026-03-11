import { createHash } from 'node:crypto';

/**
 * Normalize a title for use as a video disambiguator.
 *
 * @param {string | null | undefined} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  let t = (title || '').toLowerCase().trim();
  t = t.replace(/[^\w\s.\-]/g, '');
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/^topic\s+\d+\.\d+\s*/i, '');
  t = t.replace(/^ap\s*classroom\s*/i, '');
  t = t.replace(/^unit\s*\d+\s*(?:lesson|l)\s*\d+\s*/i, '');
  return t.trim();
}

/**
 * Compute a deterministic content hash for a registry material.
 *
 * @param {string | number} unit
 * @param {string | number} lesson
 * @param {string} materialType
 * @param {string | null} disambiguator
 * @returns {string}
 */
export function computeContentHash(unit, lesson, materialType, disambiguator = null) {
  const parts = [String(unit), String(lesson), materialType];
  if (disambiguator) parts.push(disambiguator);
  const input = parts.join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

/**
 * Find a material by content hash within a materials object.
 *
 * @param {Record<string, any>} materials
 * @param {string} hash
 * @returns {{ type: string, material: any, index?: number } | null}
 */
export function findByContentHash(materials, hash) {
  for (const [type, mat] of Object.entries(materials || {})) {
    if (type === 'videos') continue;
    if (mat?.contentHash === hash) return { type, material: mat };
  }

  const videos = Array.isArray(materials?.videos) ? materials.videos : [];
  for (let i = 0; i < videos.length; i++) {
    if (videos[i]?.contentHash === hash) {
      return { type: 'video', index: i, material: videos[i] };
    }
  }

  return null;
}
