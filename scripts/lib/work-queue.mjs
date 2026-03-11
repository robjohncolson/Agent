/**
 * work-queue.mjs — Persistent, dependency-aware work queue.
 *
 * Queue is stored as JSON at state/work-queue.json and survives restarts.
 * Each action has a type, dependencies, retry logic, and status tracking.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { AGENT_ROOT } from './paths.mjs';

export const QUEUE_PATH = join(AGENT_ROOT, 'state', 'work-queue.json');

// ── Backoff constants (ms) ────────────────────────────────────────────────────

export const BACKOFF = {
  gemini:    4 * 60 * 60 * 1000,   // 4 hours
  cdp:       1 * 60 * 60 * 1000,   // 1 hour
  codex:     30 * 60 * 1000,        // 30 minutes
  supabase:  1 * 60 * 60 * 1000,   // 1 hour
  local:     5 * 60 * 1000,         // 5 minutes
  unknown:   2 * 60 * 60 * 1000,   // 2 hours
};

export const MAX_ATTEMPTS = 5;

// ── Status values ─────────────────────────────────────────────────────────────

export const STATUS = {
  pending:      'pending',
  running:      'running',
  completed:    'completed',
  failed:       'failed',
  rateLimited:  'rate-limited',
  skipped:      'skipped',
};

// ── Action type → resource mapping ────────────────────────────────────────────

export const ACTION_RESOURCE = {
  'ingest':                'gemini-cdp',
  'content-gen-worksheet': 'codex',
  'content-gen-blooket':   'codex',
  'content-gen-drills':    'codex',
  'render-animations':     'local',
  'upload-animations':     'supabase',
  'upload-blooket':        'schoology-cdp',
  'post-schoology-B':      'schoology-cdp',
  'post-schoology-E':      'schoology-cdp',
  'verify-schoology-B':    'schoology-cdp',
  'verify-schoology-E':    'schoology-cdp',
};

// ── Resource → backoff mapping ────────────────────────────────────────────────

export const RESOURCE_BACKOFF = {
  'gemini-cdp':    BACKOFF.gemini,
  'codex':         BACKOFF.codex,
  'schoology-cdp': BACKOFF.cdp,
  'supabase':      BACKOFF.supabase,
  'local':         BACKOFF.local,
};

// ── Queue I/O ─────────────────────────────────────────────────────────────────

function createEmptyQueue() {
  return {
    version: 1,
    lastRun: null,
    stats: {
      totalActions: 0,
      completed: 0,
      pending: 0,
      failed: 0,
      rateLimited: 0,
      skipped: 0,
    },
    actions: [],
  };
}

export function loadQueue() {
  if (!existsSync(QUEUE_PATH)) {
    return createEmptyQueue();
  }
  try {
    const raw = readFileSync(QUEUE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.actions)) {
      return createEmptyQueue();
    }
    return parsed;
  } catch {
    return createEmptyQueue();
  }
}

export function saveQueue(queue) {
  mkdirSync(dirname(QUEUE_PATH), { recursive: true });
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf8');
}

// ── Queue manipulation ────────────────────────────────────────────────────────

/**
 * Idempotent enqueue — only adds if no action with this ID exists.
 * Returns true if action was added, false if already existed.
 */
export function enqueueAction(queue, action) {
  const existing = queue.actions.find(a => a.id === action.id);
  if (existing) return false;

  const now = new Date().toISOString();
  queue.actions.push({
    id: action.id,
    unit: action.unit,
    lesson: action.lesson,
    period: action.period || null,
    type: action.type,
    status: STATUS.pending,
    dependsOn: action.dependsOn || [],
    attempts: 0,
    maxAttempts: action.maxAttempts || MAX_ATTEMPTS,
    retryAfter: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    date: action.date || null,
  });
  return true;
}

/**
 * Get all actions that are ready to execute:
 * - status is pending or rate-limited with retryAfter in the past
 * - all dependencies are completed
 */
export function getReadyActions(queue) {
  const now = Date.now();
  const completedIds = new Set(
    queue.actions.filter(a => a.status === STATUS.completed || a.status === STATUS.skipped)
      .map(a => a.id)
  );

  return queue.actions.filter(action => {
    // Must be pending or rate-limited with expired backoff
    if (action.status === STATUS.pending) {
      // Check retryAfter
      if (action.retryAfter && new Date(action.retryAfter).getTime() > now) {
        return false;
      }
    } else if (action.status === STATUS.rateLimited) {
      if (action.retryAfter && new Date(action.retryAfter).getTime() > now) {
        return false;
      }
    } else {
      return false; // completed, failed, running, skipped
    }

    // All dependencies must be completed
    for (const depId of action.dependsOn) {
      if (!completedIds.has(depId)) return false;
    }

    return true;
  });
}

/**
 * Get actions grouped by resource, ready to execute.
 */
export function getReadyByResource(queue) {
  const ready = getReadyActions(queue);
  const byResource = {};
  for (const action of ready) {
    const resource = ACTION_RESOURCE[action.type] || 'unknown';
    if (!byResource[resource]) byResource[resource] = [];
    byResource[resource].push(action);
  }
  return byResource;
}

export function markRunning(queue, actionId) {
  const action = queue.actions.find(a => a.id === actionId);
  if (!action) return;
  action.status = STATUS.running;
  action.updatedAt = new Date().toISOString();
}

export function markCompleted(queue, actionId) {
  const action = queue.actions.find(a => a.id === actionId);
  if (!action) return;
  action.status = STATUS.completed;
  action.completedAt = new Date().toISOString();
  action.updatedAt = action.completedAt;
}

export function markSkipped(queue, actionId, reason) {
  const action = queue.actions.find(a => a.id === actionId);
  if (!action) return;
  action.status = STATUS.skipped;
  action.lastError = reason || 'skipped';
  action.updatedAt = new Date().toISOString();
}

export function markFailed(queue, actionId, error, backoffMs) {
  const action = queue.actions.find(a => a.id === actionId);
  if (!action) return;
  action.attempts++;
  action.lastError = typeof error === 'string' ? error : (error?.message || String(error));
  action.updatedAt = new Date().toISOString();

  if (action.attempts >= action.maxAttempts) {
    action.status = STATUS.failed;
  } else {
    action.status = STATUS.pending;
    if (backoffMs) {
      action.retryAfter = new Date(Date.now() + backoffMs).toISOString();
    }
  }
}

export function markRateLimited(queue, actionId, backoffMs) {
  const action = queue.actions.find(a => a.id === actionId);
  if (!action) return;
  action.attempts++;
  action.status = STATUS.rateLimited;
  action.retryAfter = new Date(Date.now() + (backoffMs || BACKOFF.unknown)).toISOString();
  action.lastError = 'rate-limited';
  action.updatedAt = new Date().toISOString();
}

/**
 * Reset all failed actions back to pending for retry.
 */
export function retryFailed(queue) {
  let count = 0;
  for (const action of queue.actions) {
    if (action.status === STATUS.failed) {
      action.status = STATUS.pending;
      action.retryAfter = null;
      action.attempts = 0;
      action.lastError = null;
      action.updatedAt = new Date().toISOString();
      count++;
    }
  }
  return count;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function computeStats(queue) {
  const stats = {
    totalActions: queue.actions.length,
    completed: 0,
    pending: 0,
    failed: 0,
    rateLimited: 0,
    skipped: 0,
    running: 0,
    blocked: 0,
  };

  const completedIds = new Set(
    queue.actions.filter(a => a.status === STATUS.completed || a.status === STATUS.skipped)
      .map(a => a.id)
  );

  for (const action of queue.actions) {
    switch (action.status) {
      case STATUS.completed:   stats.completed++; break;
      case STATUS.failed:      stats.failed++; break;
      case STATUS.rateLimited: stats.rateLimited++; break;
      case STATUS.skipped:     stats.skipped++; break;
      case STATUS.running:     stats.running++; break;
      case STATUS.pending: {
        // Check if blocked by unmet dependencies
        const blocked = action.dependsOn.some(depId => !completedIds.has(depId));
        if (blocked) {
          stats.blocked++;
        } else {
          stats.pending++;
        }
        break;
      }
    }
  }

  queue.stats = stats;
  return stats;
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function formatStats(stats) {
  const parts = [];
  if (stats.completed > 0)    parts.push(`${stats.completed} done`);
  if (stats.pending > 0)      parts.push(`${stats.pending} ready`);
  if (stats.blocked > 0)      parts.push(`${stats.blocked} blocked`);
  if (stats.running > 0)      parts.push(`${stats.running} running`);
  if (stats.rateLimited > 0)  parts.push(`${stats.rateLimited} rate-limited`);
  if (stats.failed > 0)       parts.push(`${stats.failed} failed`);
  if (stats.skipped > 0)      parts.push(`${stats.skipped} skipped`);
  return `${stats.totalActions} total: ${parts.join(', ')}`;
}

export function getBackoffForAction(actionType) {
  const resource = ACTION_RESOURCE[actionType] || 'unknown';
  return RESOURCE_BACKOFF[resource] || BACKOFF.unknown;
}
