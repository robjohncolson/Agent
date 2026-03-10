/**
 * event-log.mjs — Structured event emitter for the Agent Hub.
 *
 * Writes to the Supabase `agent_events` table via plain fetch (no @supabase/supabase-js).
 * All exports are fire-and-forget: they never block the caller and never throw.
 *
 * Exports:
 *   emit(eventType, category, data)   — core emitter
 *   pipeline.started / stepStarted / stepCompleted / stepFailed / completed
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// Corporate proxy (Lynn Public Schools) does TLS interception
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

// ---------------------------------------------------------------------------
// Machine ID — resolved once, then cached
// ---------------------------------------------------------------------------

let _machineId = null;

function getMachineId() {
  if (_machineId !== null) return _machineId;

  // Allow override via env (useful for CI or cross-machine delegation)
  if (process.env.AGENT_MACHINE) {
    _machineId = process.env.AGENT_MACHINE.trim();
    return _machineId;
  }

  // Resolve repo root: this file lives at scripts/lib/event-log.mjs,
  // so go up two directories from __dirname to reach the repo root.
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(thisDir, '..', '..');
  const machineIdPath = resolve(repoRoot, '.machine-id');

  try {
    _machineId = readFileSync(machineIdPath, 'utf8').trim();
  } catch {
    _machineId = 'unknown';
  }

  return _machineId;
}

// ---------------------------------------------------------------------------
// Supabase config
// ---------------------------------------------------------------------------

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing required env vars: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY'
    );
  }
  return { url, key };
}

// ---------------------------------------------------------------------------
// Core emitter
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget event emitter. Never blocks, never throws.
 *
 * @param {string} eventType - Dot-namespaced event name (e.g. 'pipeline.started')
 * @param {string} category  - Broad category (e.g. 'pipeline', 'schoology', 'blooket')
 * @param {object} data      - Arbitrary payload merged into the row's `data` column
 */
export async function emit(eventType, category, data = {}) {
  try {
    const { url, key } = getSupabaseConfig();
    const machine = getMachineId();

    const body = {
      machine,
      event_type:  eventType,
      category,
      target_repo: data.repo    ?? null,
      task_id:     data.taskId  ?? null,
      data,
    };

    const response = await fetch(`${url}/rest/v1/agent_events`, {
      method: 'POST',
      headers: {
        apikey:          key,
        Authorization:   `Bearer ${key}`,
        'Content-Type':  'application/json',
        Prefer:          'return=minimal',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      console.warn(
        `[event-log] emit failed — ${response.status} ${response.statusText}: ${text}`
      );
    }
  } catch (err) {
    console.warn(`[event-log] emit error: ${err?.message ?? String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers — pipeline lifecycle
// ---------------------------------------------------------------------------

export const pipeline = {
  /**
   * @param {string} name - Pipeline name (e.g. 'lesson-prep')
   * @param {object} meta - Additional metadata
   */
  started: (name, meta = {}) =>
    emit('pipeline.started', 'pipeline', { pipeline: name, ...meta }),

  /**
   * @param {string} name - Pipeline name
   * @param {string|number} step - Step identifier (e.g. 'step-2' or 2)
   * @param {object} meta - Additional metadata
   */
  stepStarted: (name, step, meta = {}) =>
    emit('pipeline.step.started', 'pipeline', { pipeline: name, step, ...meta }),

  /**
   * @param {string} name       - Pipeline name
   * @param {string|number} step - Step identifier
   * @param {number} durationMs - Elapsed milliseconds for the step
   * @param {object} meta       - Additional metadata
   */
  stepCompleted: (name, step, durationMs, meta = {}) =>
    emit('pipeline.step.completed', 'pipeline', {
      pipeline: name,
      step,
      duration_ms: durationMs,
      ...meta,
    }),

  /**
   * @param {string} name       - Pipeline name
   * @param {string|number} step - Step identifier
   * @param {Error|string} err  - The error that caused the failure
   */
  stepFailed: (name, step, err) =>
    emit('pipeline.step.failed', 'pipeline', {
      pipeline: name,
      step,
      error: String(err),
    }),

  /**
   * @param {string} name - Pipeline name
   * @param {object} meta - Additional metadata (e.g. total duration)
   */
  completed: (name, meta = {}) =>
    emit('pipeline.completed', 'pipeline', { pipeline: name, ...meta }),
};
