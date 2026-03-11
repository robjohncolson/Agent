/**
 * catch-up-executors.mjs — Thin executor wrappers around existing pipeline scripts.
 *
 * Each executor spawns a script as a child process and returns a structured
 * result object: { success: true, output } or { success: false, error, ... }.
 *
 * All child processes inherit NODE_TLS_REJECT_UNAUTHORIZED=0 to avoid
 * certificate issues on the school network.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT } from './paths.mjs';

const SCRIPTS_DIR = join(AGENT_ROOT, 'scripts');

// ── Shared runner ───────────────────────────────────────────────────────────

function run(cmd, timeoutMs = 300_000) {
  try {
    const output = execSync(cmd, {
      encoding: 'utf8',
      timeout: timeoutMs,
      cwd: AGENT_ROOT,
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output };
  } catch (err) {
    const stderr = err.stderr || '';
    const isRateLimit =
      stderr.includes('rate') ||
      stderr.includes('429') ||
      stderr.includes('quota');
    return {
      success: false,
      error: err.message?.substring(0, 500) || 'unknown error',
      stderr: stderr.substring(0, 500),
      isRateLimit,
    };
  }
}

// ── Individual executors ────────────────────────────────────────────────────

/**
 * 1. Ingest via Gemini AI Studio.
 *    Timeout: 10 min (Gemini is slow).
 */
function executeIngest(unit, lesson) {
  const script = join(SCRIPTS_DIR, 'aistudio-ingest.mjs');
  if (!existsSync(script)) {
    return { success: false, error: 'ingest script not found', missing: true };
  }
  return run(
    `node "${script}" --unit ${unit} --lesson ${lesson}`,
    600_000,
  );
}

/**
 * 2. Content generation (worksheet | blooket | drills).
 *    Falls back to `codex exec` if the worker script is missing.
 */
function executeContentGen(unit, lesson, contentType) {
  const worker = join(SCRIPTS_DIR, 'workers', 'codex-content-gen.mjs');

  if (existsSync(worker)) {
    return run(
      `node "${worker}" --unit ${unit} --lesson ${lesson} --type ${contentType}`,
      300_000,
    );
  }

  // Fallback: invoke codex CLI directly
  try {
    execSync('codex --version', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return { success: false, error: 'codex not found', missing: true };
  }

  return run(
    `codex exec --full-auto "Generate ${contentType} for unit ${unit} lesson ${lesson}"`,
    300_000,
  );
}

/**
 * 3. Render Manim/animation files.
 *    Timeout: 10 min.
 */
function executeRenderAnimations(unit, lesson) {
  const script = join(SCRIPTS_DIR, 'render-animations.mjs');
  if (!existsSync(script)) {
    return { success: false, error: 'render script not found', missing: true };
  }
  return run(
    `node "${script}" --unit ${unit} --lesson ${lesson} --quality m`,
    600_000,
  );
}

/**
 * 4. Upload rendered animations.
 *    Timeout: 2 min.
 */
function executeUploadAnimations(unit, lesson) {
  const script = join(SCRIPTS_DIR, 'upload-animations.mjs');
  return run(
    `node "${script}" --unit ${unit} --lesson ${lesson}`,
    120_000,
  );
}

/**
 * 5. Upload Blooket CSV.
 *    Timeout: 2 min.
 */
function executeUploadBlooket(unit, lesson) {
  const script = join(SCRIPTS_DIR, 'upload-blooket.mjs');
  return run(
    `node "${script}" --unit ${unit} --lesson ${lesson}`,
    120_000,
  );
}

/**
 * 6. Post materials to Schoology.
 *    Period B: posts fresh via post-to-schoology.mjs
 *    Period E: copies from B via copy-material-to-course.mjs (faster, no re-upload)
 *    Timeout: 3 min.
 */
function executePostSchoology(unit, lesson, period) {
  if (period === 'E') {
    // Copy from B → E using Schoology's "Copy to Course" dialog
    const copyScript = join(SCRIPTS_DIR, 'copy-material-to-course.mjs');
    if (existsSync(copyScript)) {
      return run(
        `node "${copyScript}" --unit ${unit} --lesson ${lesson} --to-period E --no-prompt`,
        180_000,
      );
    }
    // Fallback: post fresh if copy script missing
  }

  const script = join(SCRIPTS_DIR, 'post-to-schoology.mjs');
  const base = `node "${script}" --unit ${unit} --lesson ${lesson} --auto-urls --no-prompt --heal`;
  const cmd = period === 'E' ? `${base} --course 7945275798` : base;
  return run(cmd, 180_000);
}

/**
 * 7. Verify Schoology post via reconciler.
 *    Timeout: 1 min. Success = exit code 0.
 */
function executeVerifySchoology(unit, lesson, _period) {
  const script = join(SCRIPTS_DIR, 'schoology-reconcile.mjs');
  return run(
    `node "${script}" --unit ${unit} --lesson ${lesson}`,
    60_000,
  );
}

// ── Main dispatcher ─────────────────────────────────────────────────────────

/**
 * Routes an action object to the appropriate executor.
 *
 * @param {{ type: string, unit: number, lesson: number }} action
 * @returns {{ success: boolean, output?: string, error?: string }}
 */
export async function executeAction(action) {
  switch (action.type) {
    case 'ingest':
      return executeIngest(action.unit, action.lesson);
    case 'content-gen-worksheet':
      return executeContentGen(action.unit, action.lesson, 'worksheet');
    case 'content-gen-blooket':
      return executeContentGen(action.unit, action.lesson, 'blooket');
    case 'content-gen-drills':
      return executeContentGen(action.unit, action.lesson, 'drills');
    case 'render-animations':
      return executeRenderAnimations(action.unit, action.lesson);
    case 'upload-animations':
      return executeUploadAnimations(action.unit, action.lesson);
    case 'upload-blooket':
      return executeUploadBlooket(action.unit, action.lesson);
    case 'post-schoology-B':
      return executePostSchoology(action.unit, action.lesson, 'B');
    case 'post-schoology-E':
      return executePostSchoology(action.unit, action.lesson, 'E');
    case 'verify-schoology-B':
    case 'verify-schoology-E':
      return executeVerifySchoology(
        action.unit,
        action.lesson,
        action.type.endsWith('B') ? 'B' : 'E',
      );
    default:
      return { success: false, error: `Unknown action type: ${action.type}` };
  }
}
