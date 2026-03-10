/**
 * supabase-client.mjs — Shared Supabase helper for the Agent Hub.
 *
 * Uses plain fetch (no @supabase/supabase-js) against the Supabase REST API.
 * Env vars are loaded from .env via dotenv. All exported functions are
 * non-throwing — errors are logged to stderr and a graceful fallback is returned.
 *
 * Exports:
 *   writeCheckpoint(machineId, sessionState) → { ok: true } | { ok: false, error }
 *   getLatestCheckpoint()                    → checkpoint object | null
 *   isStale(localCommit)                     → { stale, ... }
 */

import 'dotenv/config';
import { execSync } from 'node:child_process';

// Corporate proxy (Lynn Public Schools) does TLS interception
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

// ---------------------------------------------------------------------------
// Helpers
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

function authHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

function getGitCommit() {
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// writeCheckpoint
// ---------------------------------------------------------------------------

/**
 * Write a checkpoint row to the `agent_checkpoints` table.
 *
 * @param {string} machineId - Identifier for the machine running the agent.
 * @param {object} sessionState - Full session state object (from state/session.json).
 * @returns {Promise<{ok: true}|{ok: false, error: string}>}
 */
export async function writeCheckpoint(machineId, sessionState) {
  try {
    const { url, key } = getSupabaseConfig();
    const agentCommit = getGitCommit();

    const body = {
      machine: machineId,
      agent_commit: agentCommit,
      active_task: sessionState.active_task ?? null,
      current_project: sessionState.current_project ?? null,
      session_state: sessionState,
    };

    const response = await fetch(`${url}/rest/v1/agent_checkpoints`, {
      method: 'POST',
      headers: {
        ...authHeaders(key),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      const msg = `Supabase POST failed — ${response.status} ${response.statusText}: ${text}`;
      console.warn(`[supabase-client] ${msg}`);
      return { ok: false, error: msg };
    }

    return { ok: true };
  } catch (err) {
    const msg = err?.message ?? String(err);
    console.warn(`[supabase-client] writeCheckpoint error: ${msg}`);
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// getLatestCheckpoint
// ---------------------------------------------------------------------------

/**
 * Retrieve the most recent checkpoint row from `agent_checkpoints`.
 *
 * @returns {Promise<object|null>} The checkpoint object, or null if none found or on error.
 */
export async function getLatestCheckpoint() {
  try {
    const { url, key } = getSupabaseConfig();

    const response = await fetch(
      `${url}/rest/v1/agent_checkpoints?order=created_at.desc&limit=1`,
      {
        method: 'GET',
        headers: authHeaders(key),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      console.warn(
        `[supabase-client] getLatestCheckpoint failed — ${response.status} ${response.statusText}: ${text}`
      );
      return null;
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    return rows[0];
  } catch (err) {
    console.warn(`[supabase-client] getLatestCheckpoint error: ${err?.message ?? err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// isStale
// ---------------------------------------------------------------------------

/**
 * Compare a local git commit against the latest remote checkpoint.
 *
 * @param {string} localCommit - The current local HEAD commit SHA.
 * @returns {Promise<
 *   { stale: false, reason: 'no-remote-checkpoint' } |
 *   { stale: false } |
 *   { stale: true, latestCheckpoint: object, behind: string }
 * >}
 */
export async function isStale(localCommit) {
  try {
    const checkpoint = await getLatestCheckpoint();

    if (!checkpoint) {
      return { stale: false, reason: 'no-remote-checkpoint' };
    }

    if (checkpoint.agent_commit === localCommit) {
      return { stale: false };
    }

    return {
      stale: true,
      latestCheckpoint: checkpoint,
      behind: checkpoint.agent_commit,
    };
  } catch (err) {
    console.warn(`[supabase-client] isStale error: ${err?.message ?? err}`);
    return { stale: false, reason: 'error' };
  }
}
