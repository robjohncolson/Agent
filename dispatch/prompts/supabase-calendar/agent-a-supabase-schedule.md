# Agent A: supabase-schedule.mjs (Supabase CRUD wrapper)

## Overview
Create `scripts/lib/supabase-schedule.mjs` — a thin CRUD wrapper around the `topic_schedule` table in Supabase.

## Target File
`scripts/lib/supabase-schedule.mjs` — **NEW**

## Pattern to Follow
Copy the fetch-based approach from `scripts/lib/supabase-client.mjs`:
- Use `dotenv/config` for env vars
- Set `NODE_TLS_REJECT_UNAUTHORIZED ??= '0'` (corporate proxy)
- Use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from env
- Non-throwing: wrap all network calls in try/catch, return `null` on failure
- Log warnings to stderr on error

## Supabase Table Schema

```sql
topic_schedule (
  id                    uuid PK,
  topic                 text NOT NULL,        -- e.g. "7.3"
  period                text NOT NULL,        -- "B" or "E"
  date                  date NOT NULL,
  title                 text,                 -- display title
  status                text DEFAULT 'scheduled',  -- scheduled | posted | taught
  schoology_folder_id   text,
  updated_at            timestamptz
)
-- Unique on (topic, period)
```

## Exports

### `getSchedule(period)`
- Fetches all rows for a given period ("B" or "E")
- Returns `Map<string, { date, title, status, schoologyFolderId }>` keyed by topic
- On error, returns `null` (callers fall back to local JSON)
- REST query: `GET /rest/v1/topic_schedule?period=eq.{period}&select=topic,date,title,status,schoology_folder_id`

### `upsertTopic(topic, period, { date, title, status, schoologyFolderId })`
- Upserts a single row using the `(topic, period)` unique constraint
- Only sends non-undefined fields in the body
- REST: `POST /rest/v1/topic_schedule` with header `Prefer: resolution=merge-duplicates`
- Maps JS camelCase `schoologyFolderId` → DB snake_case `schoology_folder_id`
- Returns `{ ok: true }` or `{ ok: false, error }` (non-throwing)

### `bulkSync(scheduleJson, period)`
- Takes the parsed contents of `topic-schedule.json` (a `Record<string, string>` of topic → ISO date)
- Upserts one row per entry using `upsertTopic()`
- Returns `{ synced: number, errors: number }`
- Used by the migration script

## Implementation Notes

```javascript
import 'dotenv/config';
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return { url, key };
}

function headers(key) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}
```

## Validation
- `period` must be "B" or "E"
- `topic` must be a string like "7.3" (digits.digits)
- `date` must be ISO format "YYYY-MM-DD"

## Do NOT
- Do not import `@supabase/supabase-js` — use plain `fetch`
- Do not throw on network errors — return null / `{ ok: false }`
- Do not modify any other files
