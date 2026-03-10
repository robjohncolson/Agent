/**
 * upload-state.mjs - Per-file upload state persistence.
 * Tracks upload status for each animation file in state/animation-uploads.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const STATE_PATH = 'state/animation-uploads.json';

/** Load state for a unit+lesson. Returns { unit, lesson, files: {} } */
export function loadState(unit, lesson) {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    if (String(raw.unit) === String(unit) && String(raw.lesson) === String(lesson)) {
      return raw;
    }
  } catch {
    // File missing, corrupted, or different lesson — start fresh
  }
  return { unit, lesson, files: {} };
}

/** Save state to disk */
export function saveState(state) {
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

/** Update a single file entry in state (does NOT auto-save — call saveState() when done) */
export function updateFileState(state, filename, update) {
  state.files[filename] = { ...(state.files[filename] || {}), ...update };
}
