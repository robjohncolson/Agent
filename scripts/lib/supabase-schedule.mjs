/**
 * supabase-schedule.mjs — CRUD wrapper for the Supabase `topic_schedule` table.
 *
 * Uses plain fetch (no @supabase/supabase-js) against the Supabase REST API.
 * Env vars are loaded from .env via dotenv. All exported functions are
 * non-throwing — errors are logged to stderr and a graceful fallback is returned.
 *
 * Exports:
 *   getSchedule(period)                → Map<topic, { date, title, status, schoologyFolderId }> | null
 *   upsertTopic(topic, period, fields) → { ok: true } | { ok: false, error }
 *   upsertLessonUrls(topic, fields)   → { ok: true } | { ok: false, error }
 *   bulkSync(scheduleJson, period)     → { synced, errors }
 */

import 'dotenv/config';

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

const STATUS_RANK = Object.freeze({
  scheduled: 0,
  posted: 1,
  taught: 2,
});

export function isStatusDowngrade(current, incoming) {
  return (STATUS_RANK[incoming] ?? -1) < (STATUS_RANK[current] ?? -1);
}

async function fetchCurrentTopic(url, key, topic, period) {
  const filters =
    `topic=eq.${encodeURIComponent(topic)}` +
    `&period=eq.${encodeURIComponent(period)}` +
    `&select=status&limit=1`;

  const response = await fetch(`${url}/rest/v1/topic_schedule?${filters}`, {
    method: 'GET',
    headers: authHeaders(key),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '(no body)');
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// getSchedule
// ---------------------------------------------------------------------------

/**
 * Fetch all schedule rows for a given period.
 *
 * @param {string} period - "B" or "E"
 * @returns {Promise<Map<string, { date: string, title: string|null, status: string, schoologyFolderId: string|null }>|null>}
 *   Map keyed by topic, or null on error.
 */
export async function getSchedule(period) {
  try {
    const { url, key } = getSupabaseConfig();

    const response = await fetch(
      `${url}/rest/v1/topic_schedule?period=eq.${encodeURIComponent(period)}&select=topic,date,title,status,schoology_folder_id`,
      {
        method: 'GET',
        headers: authHeaders(key),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      console.warn(
        `[supabase-schedule] getSchedule failed — ${response.status} ${response.statusText}: ${text}`
      );
      return null;
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) {
      console.warn('[supabase-schedule] getSchedule — unexpected response shape');
      return null;
    }

    const map = new Map();
    for (const row of rows) {
      map.set(row.topic, {
        date: row.date,
        title: row.title ?? null,
        status: row.status ?? 'scheduled',
        schoologyFolderId: row.schoology_folder_id ?? null,
      });
    }
    return map;
  } catch (err) {
    console.warn(`[supabase-schedule] getSchedule error: ${err?.message ?? err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// upsertTopic
// ---------------------------------------------------------------------------

/**
 * Upsert a single topic_schedule row using the (topic, period) unique constraint.
 * Only sends non-undefined fields.
 *
 * @param {string} topic - e.g. "7.3"
 * @param {string} period - "B" or "E"
 * @param {{ date?: string, title?: string, status?: string, schoologyFolderId?: string }} fields
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function upsertTopic(topic, period, fields = {}) {
  try {
    const { url, key } = getSupabaseConfig();

    const payload = {};
    if (fields.date !== undefined) payload.date = fields.date;
    if (fields.title !== undefined) payload.title = fields.title;
    if (fields.status !== undefined) payload.status = fields.status;
    if (fields.schoologyFolderId !== undefined) payload.schoology_folder_id = fields.schoologyFolderId;

    if (payload.status !== undefined) {
      try {
        const currentRow = await fetchCurrentTopic(url, key, topic, period);
        const currentStatus = currentRow?.status ?? null;
        if (currentStatus && isStatusDowngrade(currentStatus, payload.status)) {
          console.warn(
            `[supabase-schedule] Refusing status downgrade for ${topic} Period ${period}: ${currentStatus} -> ${payload.status}`
          );
          delete payload.status;
        }
      } catch (err) {
        const msg = err?.message ?? String(err);
        console.warn(
          `[supabase-schedule] Status lookup failed for ${topic} Period ${period}, omitting status field: ${msg}`
        );
        delete payload.status;
      }
    }

    payload.updated_at = new Date().toISOString();

    let response;
    if (fields.date === undefined) {
      const filters =
        `topic=eq.${encodeURIComponent(topic)}&period=eq.${encodeURIComponent(period)}`;
      response = await fetch(`${url}/rest/v1/topic_schedule?${filters}`, {
        method: 'PATCH',
        headers: {
          ...authHeaders(key),
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '(no body)');
        const msg = `Supabase patch failed — ${response.status} ${response.statusText}: ${text}`;
        console.warn(`[supabase-schedule] ${msg}`);
        return { ok: false, error: msg };
      }

      const rows = await response.json().catch(() => null);
      if (!Array.isArray(rows) || rows.length === 0) {
        const msg = `Supabase patch matched no existing row for ${topic} Period ${period}`;
        console.warn(`[supabase-schedule] ${msg}`);
        return { ok: false, error: msg };
      }

      return { ok: true };
    }

    const body = { topic, period, ...payload };
    const conflictTarget = encodeURIComponent('topic,period');
    response = await fetch(`${url}/rest/v1/topic_schedule?on_conflict=${conflictTarget}`, {
      method: 'POST',
      headers: {
        ...authHeaders(key),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      const msg = `Supabase upsert failed — ${response.status} ${response.statusText}: ${text}`;
      console.warn(`[supabase-schedule] ${msg}`);
      return { ok: false, error: msg };
    }

    return { ok: true };
  } catch (err) {
    const msg = err?.message ?? String(err);
    console.warn(`[supabase-schedule] upsertTopic error: ${msg}`);
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// upsertLessonUrls
// ---------------------------------------------------------------------------

/**
 * Upsert a single lesson_urls row (topic-global material URLs).
 * Only sends non-undefined fields — safe for partial poster runs.
 *
 * @param {string} topic - e.g. "7.7"
 * @param {{ worksheetUrl?: string, drillsUrl?: string, quizUrl?: string, blooketUrl?: string }} fields
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function upsertLessonUrls(topic, fields = {}) {
  try {
    const { url, key } = getSupabaseConfig();

    const payload = { topic, updated_at: new Date().toISOString() };
    if (fields.worksheetUrl !== undefined) payload.worksheet_url = fields.worksheetUrl;
    if (fields.drillsUrl !== undefined)    payload.drills_url = fields.drillsUrl;
    if (fields.quizUrl !== undefined)      payload.quiz_url = fields.quizUrl;
    if (fields.blooketUrl !== undefined)   payload.blooket_url = fields.blooketUrl;

    const response = await fetch(
      `${url}/rest/v1/lesson_urls?on_conflict=topic`,
      {
        method: 'POST',
        headers: {
          ...authHeaders(key),
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      const msg = `Supabase lesson_urls upsert failed — ${response.status} ${response.statusText}: ${text}`;
      console.warn(`[supabase-schedule] ${msg}`);
      return { ok: false, error: msg };
    }

    return { ok: true };
  } catch (err) {
    const msg = err?.message ?? String(err);
    console.warn(`[supabase-schedule] upsertLessonUrls error: ${msg}`);
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// bulkSync
// ---------------------------------------------------------------------------

/**
 * Sync a parsed topic-schedule.json (Record<topic, ISOdate>) to Supabase.
 * Upserts each entry via upsertTopic().
 *
 * @param {Record<string, string>} scheduleJson - topic → ISO date mapping
 * @param {string} period - "B" or "E"
 * @returns {Promise<{ synced: number, errors: number }>}
 */
export async function bulkSync(scheduleJson, period) {
  let synced = 0;
  let errors = 0;

  for (const [topic, date] of Object.entries(scheduleJson)) {
    const result = await upsertTopic(topic, period, { date });
    if (result.ok) {
      synced++;
    } else {
      errors++;
    }
  }

  return { synced, errors };
}
