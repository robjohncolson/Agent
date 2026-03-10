# Dashboard Implementation Prompts

Organized by wave from `design/dashboard-dep-graph.md`. Each prompt is self-contained for a Codex agent.

## Wave 1 (parallel: 1A + 1B)

### Wave 1A: Formatters Utility

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `dashboard/lib/formatters.js`

```javascript
/**
 * formatters.js — Shared formatting helpers for the Agent Hub dashboard.
 * No dependencies. Pure functions only.
 */

/** Format ISO timestamp to locale string */
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

/** Format milliseconds to human-readable duration */
export function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Format seconds to human-readable duration */
export function formatDurationSec(sec) {
  return formatDuration(sec * 1000);
}

/** Calculate staleness from ISO timestamp. Returns { text, level } */
export function staleness(iso) {
  if (!iso) return { text: 'never', level: 'stale' };
  const ageMs = Date.now() - new Date(iso).getTime();
  const hours = ageMs / 3600000;
  if (hours < 1) return { text: `${Math.round(hours * 60)}m ago`, level: 'fresh' };
  if (hours < 2) return { text: `${hours.toFixed(1)}h ago`, level: 'fresh' };
  if (hours < 24) return { text: `${Math.round(hours)}h ago`, level: 'warn' };
  return { text: `${Math.round(hours / 24)}d ago`, level: 'stale' };
}

/** Return a status badge HTML string */
export function statusBadge(status) {
  const colors = {
    done: 'badge-green', completed: 'badge-green', running: 'badge-yellow',
    failed: 'badge-red', skipped: 'badge-gray', timeout: 'badge-red'
  };
  const cls = colors[status] || 'badge-gray';
  return `<span class="badge ${cls}">${status || 'unknown'}</span>`;
}

/** Relative time (e.g. "3 minutes ago") */
export function timeAgo(iso) {
  if (!iso) return '—';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
```

Create only this one file. Do not modify any other files.
````

### Wave 1B: Prerequisites + Supabase Config Contract

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `dashboard/lib/supabase-client.js`

The dashboard reads config from `<meta>` tags in index.html. This avoids any build step.

```javascript
/**
 * supabase-client.js — Initialize Supabase client from meta tags.
 *
 * Reads SUPABASE_URL and SUPABASE_ANON_KEY from <meta> tags in index.html.
 * Falls back to window.__SUPABASE_URL / __SUPABASE_ANON_KEY for testing.
 */

function getMeta(name) {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el ? el.content : null;
}

const SUPABASE_URL = getMeta('supabase-url') || window.__SUPABASE_URL || '';
const SUPABASE_ANON_KEY = getMeta('supabase-anon-key') || window.__SUPABASE_ANON_KEY || '';

let _client = null;

export function getClient() {
  if (_client) return _client;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[supabase-client] Missing SUPABASE_URL or SUPABASE_ANON_KEY meta tags');
    return null;
  }
  // Use supabase-js from CDN (loaded in index.html)
  _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

/** Helper: run a select query. Returns { data, error }. */
export async function query(table, options = {}) {
  const client = getClient();
  if (!client) return { data: null, error: 'No Supabase client' };

  let q = client.from(table).select(options.select || '*');
  if (options.order) q = q.order(options.order, { ascending: options.ascending ?? false });
  if (options.limit) q = q.limit(options.limit);
  if (options.gte) q = q.gte(options.gte[0], options.gte[1]);
  if (options.eq) q = q.eq(options.eq[0], options.eq[1]);

  const { data, error } = await q;
  if (error) console.warn(`[supabase-client] query ${table} error:`, error);
  return { data, error };
}
```

Create only this one file. Do not modify any other files.
````

## Wave 2 (parallel: 2A + 2B)

### Wave 2A: SPA Shell (index.html)

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `dashboard/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Hub Dashboard</title>
  <meta name="supabase-url" content="https://hgvnytaqmuybzbotosyj.supabase.co">
  <meta name="supabase-anon-key" content="REPLACE_WITH_ANON_KEY">
  <link rel="stylesheet" href="style.css">
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
</head>
<body>
  <header>
    <h1>Agent Hub</h1>
    <nav id="tabs">
      <button class="tab active" data-view="pipeline">Pipelines</button>
      <button class="tab" data-view="timeline">Timeline</button>
      <button class="tab" data-view="checkpoints">Checkpoints</button>
      <button class="tab" data-view="repos">Repos</button>
    </nav>
    <div id="controls">
      <label><input type="checkbox" id="auto-refresh"> Auto-refresh (30s)</label>
    </div>
  </header>
  <main>
    <div id="loading" class="hidden">Loading...</div>
    <div id="error" class="hidden"></div>
    <div id="view-pipeline" class="view active"></div>
    <div id="view-timeline" class="view hidden"></div>
    <div id="view-checkpoints" class="view hidden"></div>
    <div id="view-repos" class="view hidden"></div>
  </main>
  <script type="module" src="app.js"></script>
</body>
</html>
```

Create only this one file. Do not modify any other files.
````

### Wave 2B: (handled by Wave 1B above — supabase-client.js already covers step 2)

## Wave 3 (parallel: 3A + 3B)

### Wave 3A: Dark Theme CSS

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `dashboard/style.css`

```css
/* Agent Hub Dashboard — Dark Theme */
:root {
  --bg: #0d1117;
  --surface: #161b22;
  --border: #30363d;
  --text: #c9d1d9;
  --text-muted: #8b949e;
  --accent: #58a6ff;
  --green: #3fb950;
  --yellow: #d29922;
  --red: #f85149;
  --gray: #484f58;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}

header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

header h1 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--accent);
}

nav#tabs { display: flex; gap: 0.25rem; }

.tab {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85rem;
}
.tab:hover { color: var(--text); border-color: var(--text-muted); }
.tab.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }

#controls { margin-left: auto; font-size: 0.8rem; color: var(--text-muted); }
#controls label { display: flex; align-items: center; gap: 0.4rem; cursor: pointer; }

main { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }

.view { display: none; }
.view.active { display: block; }
.hidden { display: none !important; }

/* Tables */
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
th { color: var(--text-muted); font-weight: 500; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
tr:hover { background: rgba(88,166,255,0.04); }

/* Badges */
.badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.badge-green { background: rgba(63,185,80,0.15); color: var(--green); }
.badge-yellow { background: rgba(210,153,34,0.15); color: var(--yellow); }
.badge-red { background: rgba(248,81,73,0.15); color: var(--red); }
.badge-gray { background: rgba(72,79,88,0.25); color: var(--text-muted); }

/* Cards */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 0.75rem;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}
.card-header h3 { font-size: 0.9rem; font-weight: 500; }
.card-detail { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem; }

/* Timeline feed */
.feed-item {
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 1rem;
  align-items: baseline;
  font-size: 0.85rem;
}
.feed-time { color: var(--text-muted); min-width: 7rem; font-size: 0.8rem; }
.feed-body { flex: 1; }

/* Loading fade */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.fade-in { animation: fadeIn 0.2s ease-in; }

/* Responsive */
@media (max-width: 640px) {
  header { padding: 0.5rem; }
  main { padding: 0.75rem; }
  .feed-item { flex-direction: column; gap: 0.25rem; }
}
```

Create only this one file. Do not modify any other files.
````

### Wave 3B: App Orchestration

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `dashboard/app.js`

```javascript
/**
 * app.js — Main dashboard orchestration.
 * Handles tab routing, auto-refresh, and component lifecycle.
 */

import { getClient } from './lib/supabase-client.js';

// Dynamic component imports
const components = {};

async function loadComponent(name) {
  if (components[name]) return components[name];
  const mod = await import(`./components/${name}.js`);
  components[name] = mod;
  return mod;
}

// State
let activeView = 'pipeline';
let refreshTimer = null;

const VIEW_MAP = {
  pipeline: 'pipeline-view',
  timeline: 'event-timeline',
  checkpoints: 'checkpoint-view',
  repos: 'repo-health'
};

// Tab switching
function switchView(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach(el => {
    el.classList.toggle('active', el.id === `view-${view}`);
    el.classList.toggle('hidden', el.id !== `view-${view}`);
  });
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  refreshCurrentView();
}

// Refresh
async function refreshCurrentView() {
  const el = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  el.classList.remove('hidden');
  errorEl.classList.add('hidden');

  try {
    const componentName = VIEW_MAP[activeView];
    const component = await loadComponent(componentName);
    const container = document.querySelector(`#view-${activeView}`);
    await component.render(container);
  } catch (err) {
    errorEl.textContent = `Error: ${err.message}`;
    errorEl.classList.remove('hidden');
  } finally {
    el.classList.add('hidden');
  }
}

// Auto-refresh
function toggleAutoRefresh(enabled) {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (enabled) {
    refreshTimer = setInterval(refreshCurrentView, 30000);
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  // Tab clicks
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Auto-refresh toggle
  const autoRefreshCb = document.getElementById('auto-refresh');
  autoRefreshCb.addEventListener('change', () => toggleAutoRefresh(autoRefreshCb.checked));

  // Check Supabase connectivity
  const client = getClient();
  if (!client) {
    document.getElementById('error').textContent = 'Supabase not configured. Set meta tags in index.html.';
    document.getElementById('error').classList.remove('hidden');
    return;
  }

  // Initial load
  switchView('pipeline');
});
```

Create only this one file. Do not modify any other files.
````

## Wave 4 (parallel: 4A + 4B + 4C + 4D)

### Wave 4A: Event Timeline Component

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `dashboard/components/event-timeline.js`

```javascript
/**
 * event-timeline.js — Reverse-chronological event feed.
 * Queries agent_events table, renders as a feed with expandable payloads.
 */

import { query } from '../lib/supabase-client.js';
import { formatDate, statusBadge, timeAgo } from '../lib/formatters.js';

export async function render(container) {
  const { data, error } = await query('agent_events', {
    order: 'created_at',
    ascending: false,
    limit: 100
  });

  if (error || !data) {
    container.innerHTML = `<p class="card-detail">Failed to load events: ${error || 'no data'}</p>`;
    return;
  }

  if (data.length === 0) {
    container.innerHTML = '<p class="card-detail">No events recorded yet.</p>';
    return;
  }

  container.innerHTML = data.map(ev => `
    <div class="feed-item fade-in">
      <span class="feed-time">${timeAgo(ev.created_at)}</span>
      <span class="feed-body">
        ${statusBadge(ev.data?.status || ev.event_type.split('.').pop())}
        <strong>${ev.event_type}</strong>
        ${ev.data?.step ? `— step: ${ev.data.step}` : ''}
        ${ev.data?.pipeline ? `(${ev.data.pipeline})` : ''}
        ${ev.machine ? `<span class="card-detail">@ ${ev.machine}</span>` : ''}
      </span>
    </div>
  `).join('');
}
```

Create only this one file. Do not modify any other files.
````

### Wave 4B: Pipeline View Component

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `dashboard/components/pipeline-view.js`

```javascript
/**
 * pipeline-view.js — Pipeline runs grouped by pipeline_run_id or timestamp.
 * Shows step-by-step progress with timing and status.
 */

import { query } from '../lib/supabase-client.js';
import { formatDate, formatDuration, statusBadge } from '../lib/formatters.js';

export async function render(container) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await query('agent_events', {
    order: 'created_at',
    ascending: false,
    limit: 500,
    gte: ['created_at', sevenDaysAgo]
  });

  if (error || !data) {
    container.innerHTML = `<p class="card-detail">Failed to load pipeline data: ${error || 'no data'}</p>`;
    return;
  }

  // Group by pipeline runs (cluster pipeline.started -> pipeline.completed sequences)
  const runs = groupPipelineRuns(data.filter(e => e.category === 'pipeline'));

  if (runs.length === 0) {
    container.innerHTML = '<p class="card-detail">No pipeline runs in the last 7 days.</p>';
    return;
  }

  container.innerHTML = runs.map(run => `
    <div class="card fade-in">
      <div class="card-header">
        <h3>${run.name || 'pipeline'} — ${formatDate(run.startedAt)}</h3>
        ${statusBadge(run.status)}
      </div>
      <div class="card-detail">
        ${run.steps.map(s => `
          <div class="feed-item" style="border:none;padding:0.3rem 0">
            ${statusBadge(s.status)}
            <span>${s.step}</span>
            ${s.duration ? `<span class="card-detail">${formatDuration(s.duration)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function groupPipelineRuns(events) {
  const runs = [];
  let current = null;

  // Events are newest-first, reverse for chronological processing
  const sorted = [...events].reverse();

  for (const ev of sorted) {
    if (ev.event_type === 'pipeline.started') {
      current = {
        name: ev.data?.pipeline || 'pipeline',
        startedAt: ev.created_at,
        status: 'running',
        steps: []
      };
      runs.push(current);
    } else if (ev.event_type === 'pipeline.completed' && current) {
      current.status = 'done';
      current = null;
    } else if (ev.event_type.startsWith('pipeline.step.') && current) {
      const action = ev.event_type.split('.').pop(); // started, completed, failed
      const stepName = ev.data?.step || '?';
      const existing = current.steps.find(s => s.step === stepName);
      if (existing) {
        if (action === 'completed') { existing.status = 'done'; existing.duration = ev.data?.duration_ms; }
        else if (action === 'failed') { existing.status = 'failed'; }
      } else {
        current.steps.push({
          step: stepName,
          status: action === 'completed' ? 'done' : action === 'failed' ? 'failed' : 'running',
          duration: ev.data?.duration_ms
        });
      }
    }
  }
  return runs.reverse(); // newest first
}
```

Create only this one file. Do not modify any other files.
````

### Wave 4C: Checkpoint View Component

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `dashboard/components/checkpoint-view.js`

```javascript
/**
 * checkpoint-view.js — Checkpoint history with staleness indicators.
 */

import { query } from '../lib/supabase-client.js';
import { formatDate, staleness } from '../lib/formatters.js';

export async function render(container) {
  const { data, error } = await query('agent_checkpoints', {
    order: 'created_at',
    ascending: false,
    limit: 50
  });

  if (error || !data) {
    container.innerHTML = `<p class="card-detail">Failed to load checkpoints: ${error || 'no data'}</p>`;
    return;
  }

  if (data.length === 0) {
    container.innerHTML = '<p class="card-detail">No checkpoints recorded yet.</p>';
    return;
  }

  // Detect gaps > 2 hours
  const rows = data.map((cp, i) => {
    const gap = i < data.length - 1
      ? (new Date(cp.created_at) - new Date(data[i + 1].created_at)) / 3600000
      : 0;
    const s = staleness(cp.created_at);
    return { ...cp, gap, staleness: s };
  });

  container.innerHTML = `
    <table>
      <thead><tr>
        <th>Time</th><th>Machine</th><th>Trigger</th><th>Commit</th><th>Staleness</th><th>Gap</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr class="fade-in">
            <td>${formatDate(r.created_at)}</td>
            <td>${r.machine_id || '—'}</td>
            <td>${r.trigger || '—'}</td>
            <td><code>${(r.commit_hash || '—').slice(0, 7)}</code></td>
            <td><span class="badge badge-${r.staleness.level === 'fresh' ? 'green' : r.staleness.level === 'warn' ? 'yellow' : 'red'}">${r.staleness.text}</span></td>
            <td>${r.gap > 2 ? `<span class="badge badge-yellow">${r.gap.toFixed(1)}h gap</span>` : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
```

Create only this one file. Do not modify any other files.
````

### Wave 4D: Repo Health Component

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `dashboard/components/repo-health.js`

```javascript
/**
 * repo-health.js — Repo status from registry, cross-referenced with checkpoints.
 */

import { query } from '../lib/supabase-client.js';
import { staleness, formatDate } from '../lib/formatters.js';

// Bundled at build time or fetched. For now, fetch from repo root.
async function loadRepos() {
  try {
    const res = await fetch('repos.json');
    if (res.ok) return await res.json();
  } catch {}
  // Fallback: hardcoded from registry
  return [
    { id: 'agent', name: 'Agent', description: 'LLM routing hub' },
    { id: 'lrsl-driller', name: 'lrsl-driller', description: 'AP Stats drill engine' },
    { id: 'apstats-live-worksheet', name: 'apstats-live-worksheet', description: 'Live worksheets' },
    { id: 'curriculum-render', name: 'curriculum_render', description: 'Curriculum renderer' },
  ];
}

export async function render(container) {
  const [repos, checkpointResult] = await Promise.all([
    loadRepos(),
    query('agent_checkpoints', { order: 'created_at', ascending: false, limit: 20 })
  ]);

  const checkpoints = checkpointResult.data || [];

  container.innerHTML = `
    <table>
      <thead><tr>
        <th>Repo</th><th>Description</th><th>Last Checkpoint</th><th>Machine</th><th>Freshness</th>
      </tr></thead>
      <tbody>
        ${repos.map(repo => {
          const cp = checkpoints.find(c => (c.session_data?.current_project || '').includes(repo.id));
          const s = cp ? staleness(cp.created_at) : { text: 'no data', level: 'stale' };
          return `
            <tr class="fade-in">
              <td><strong>${repo.name || repo.id}</strong></td>
              <td class="card-detail">${repo.description || '—'}</td>
              <td>${cp ? formatDate(cp.created_at) : '—'}</td>
              <td>${cp?.machine_id || '—'}</td>
              <td><span class="badge badge-${s.level === 'fresh' ? 'green' : s.level === 'warn' ? 'yellow' : 'red'}">${s.text}</span></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}
```

Create only this one file. Do not modify any other files.
````

## Wave 5: Integration Pass

````text
Repo root: C:\Users\ColsonR\Agent

Read `dashboard/app.js` and all four `dashboard/components/*.js` files.

Verify that:
1. All component modules export a `render(container)` function
2. `app.js` correctly maps tab names to component module names in VIEW_MAP
3. Tab switching shows/hides the correct view div
4. Auto-refresh toggle starts/stops the 30s interval
5. Loading indicator shows during fetch, hides after

Fix any wiring issues found. Do not change component logic.
````

## Wave 6: Dockerfile

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `dashboard/Dockerfile`

```dockerfile
FROM caddy:2-alpine
COPY . /srv
COPY <<EOF /etc/caddy/Caddyfile
:8080 {
    root * /srv
    file_server
    try_files {path} /index.html
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
    }
}
EOF
EXPOSE 8080
```

Create only this one file. Do not modify any other files.
````

## Wave 7: README

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `dashboard/README.md`

Contents:
- Title: Agent Hub Dashboard
- Quick start: open index.html in browser, set meta tags for Supabase
- Environment: SUPABASE_URL, SUPABASE_ANON_KEY (via meta tags or Railway env vars)
- Railway deploy: `railway up` from dashboard/ directory
- Supabase RLS: read-only anon access required on agent_events and agent_checkpoints
- Repo health: copy registry/repos.json to dashboard/repos.json for the repo health view

Keep it under 50 lines.
````
