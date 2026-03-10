# Agent Hub v4 — External Visibility Dashboard Spec

## Goal
Build a lightweight, read-only web dashboard that surfaces pipeline status, event timelines, checkpoint history, and repo health from existing Supabase tables (`agent_events`, `agent_checkpoints`). Deployable to Railway as a static site with client-side Supabase queries.

## Architecture

### Stack
- **No framework** — static HTML + vanilla JS + CSS
- **Supabase JS client** (CDN) for data queries
- **Single-page app** with tab-based navigation
- **Railway-ready**: `Dockerfile` or `nixpacks.toml` serving static files via a lightweight HTTP server

### Directory Structure
```
dashboard/
├── index.html          # Main SPA shell with tab navigation
├── style.css           # Minimal responsive CSS (dark theme)
├── app.js              # Main app: auth, routing, data fetching
├── components/
│   ├── pipeline-view.js    # Active/recent pipeline runs
│   ├── event-timeline.js   # Chronological event feed
│   ├── checkpoint-view.js  # Checkpoint history per machine
│   └── repo-health.js      # Repo status from registry
├── lib/
│   ├── supabase-client.js  # Supabase init with env vars
│   └── formatters.js       # Date, duration, status badge formatters
├── Dockerfile              # nginx or caddy serving static files
└── README.md               # Setup + Railway deploy instructions
```

### Authentication
- **Phase 1**: Supabase anon key with RLS policies (read-only for dashboard)
- **Phase 2 (future)**: Supabase Auth with magic link for the user
- Config: `SUPABASE_URL` and `SUPABASE_ANON_KEY` injected at build time or via `<meta>` tags

## Views

### 1. Pipeline Runs (default view)
- Query `agent_events` grouped by `pipeline_run_id`
- Show: pipeline name, start time, current step, status (running/done/failed)
- Each run expands to show step-by-step progress with timing
- Color-coded: green (done), yellow (running), red (failed), gray (skipped)
- Filter by date range, pipeline name

### 2. Event Timeline
- Reverse-chronological feed of all `agent_events`
- Show: timestamp, event type, step name, machine, status, duration
- Click to expand full event payload
- Filter by: event type, machine, date range
- Auto-refresh toggle (polls every 30s)

### 3. Checkpoint History
- Query `agent_checkpoints` ordered by timestamp
- Show: machine, trigger, commit hash, staleness indicator
- Timeline visualization: dots on a horizontal axis showing checkpoint frequency
- Highlight gaps > 2 hours

### 4. Repo Health
- Read from `registry/repos.json` (bundled at build time or fetched via API)
- Show: repo name, last checkpoint commit, status, machine
- Cross-reference with `agent_checkpoints` for freshness

## Data Model

### Supabase Queries

```sql
-- Recent pipeline runs (last 7 days)
SELECT * FROM agent_events
WHERE created_at > now() - interval '7 days'
ORDER BY created_at DESC;

-- Checkpoints by machine
SELECT * FROM agent_checkpoints
WHERE machine_id = 'colsonr-work'
ORDER BY created_at DESC
LIMIT 50;

-- Pipeline run detail
SELECT * FROM agent_events
WHERE pipeline_run_id = ?
ORDER BY created_at ASC;
```

### Expected `agent_events` Schema
```json
{
  "id": "uuid",
  "pipeline_run_id": "string",
  "event_type": "string (step_start | step_end | pipeline_start | pipeline_end)",
  "step_name": "string",
  "status": "string (running | done | failed | skipped)",
  "machine_id": "string",
  "metadata": "jsonb",
  "created_at": "timestamptz"
}
```

### Expected `agent_checkpoints` Schema
```json
{
  "id": "uuid",
  "machine_id": "string",
  "trigger": "string",
  "commit_hash": "string",
  "session_data": "jsonb",
  "created_at": "timestamptz"
}
```

## Styling
- Dark theme (matches terminal aesthetic)
- Monospace font for data, sans-serif for labels
- Responsive: works on phone for quick status checks
- Status badges: colored pills (green/yellow/red/gray)
- Minimal animations (fade in on data load)

## Railway Deployment
- `Dockerfile`: multi-stage — copy static files, serve with `caddy` or `nginx`
- Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- No build step needed (vanilla JS, no bundler)
- Health check: `GET /` returns 200

## RLS Policies (Supabase)
```sql
-- Read-only for anon users
CREATE POLICY "anon_read_events" ON agent_events
  FOR SELECT USING (true);

CREATE POLICY "anon_read_checkpoints" ON agent_checkpoints
  FOR SELECT USING (true);
```

## Implementation Order
1. `lib/supabase-client.js` + `lib/formatters.js` (foundation)
2. `index.html` + `style.css` (shell + dark theme)
3. `app.js` (tab routing, data refresh)
4. `components/event-timeline.js` (simplest view, validates data flow)
5. `components/pipeline-view.js` (grouped events)
6. `components/checkpoint-view.js` (checkpoint table)
7. `components/repo-health.js` (registry display)
8. `Dockerfile` + `README.md` (deployment)

## Out of Scope (v4)
- Write operations / control plane (stays in CLI)
- Authentication beyond anon key
- WebSocket realtime (that's v5)
- Workflow automation (that's v6)

## Files Changed
- New directory: `dashboard/` with ~10 files
- No changes to existing code
