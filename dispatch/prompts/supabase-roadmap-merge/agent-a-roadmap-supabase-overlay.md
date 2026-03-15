# Agent A: Supabase Overlay + Period Deep-Linking

**File:** `C:/Users/ColsonR/apstats-live-worksheet/ap_stats_roadmap_square_mode.html`
**Method:** CC-direct (multi-touch-point coordination in one large file)

## Changes required

### 1. Add Supabase config constants (after existing `SCHOOLOGY_COURSE_E` line ~2888)

```js
const SUPABASE_URL = 'https://hgvnytaqmuybzbotosyj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhndm55dGFxbXV5Ynpib3Rvc3lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxNTE5MTMsImV4cCI6MjA4MDcyNzkxM30.-LcH_zly4pXoX_2Vra-RbH9twPvUj6xAJp66xPi02tU';
const _supaCache = {};  // keyed by period, { rows, ts }
```

### 2. Add Supabase fetch + merge function (after `loadRegistry()`)

```js
async function loadSupabaseOverlay(period) {
  // Cache: reuse if <60s old
  const cached = _supaCache[period];
  if (cached && Date.now() - cached.ts < 60000) {
    mergeSupabase(cached.rows, period);
    return;
  }
  try {
    const url = SUPABASE_URL + '/rest/v1/topic_schedule?period=eq.' + period +
      '&select=topic,date,title,status,schoology_folder_id&order=date.asc';
    const resp = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } });
    if (!resp.ok) return;
    const rows = await resp.json();
    _supaCache[period] = { rows, ts: Date.now() };
    mergeSupabase(rows, period);
  } catch (e) { /* fail silently — baked data is fine */ }
}

function mergeSupabase(rows, period) {
  if (!REGISTRY || !REGISTRY.lessons) return;
  const courseId = period === 'B' ? SCHOOLOGY_COURSE_B : SCHOOLOGY_COURSE_E;
  for (const row of rows) {
    const lesson = REGISTRY.lessons[row.topic];
    if (!lesson || !lesson.periods) continue;
    if (!lesson.periods[period]) lesson.periods[period] = {};
    const p = lesson.periods[period];
    if (row.schoology_folder_id) {
      p.schoologyFolder = 'https://lynnschools.schoology.com/course/' + courseId + '/materials?f=' + row.schoology_folder_id;
    }
    p.posted = row.status === 'posted' || row.status === 'taught';
    p.syncStatus = row.status;
    p.syncSource = 'supabase';
  }
}
```

### 3. Modify `loadRegistry()` (~line 2700) to chain Supabase overlay

Current:
```js
async function loadRegistry() {
  try {
    const resp = await fetch('roadmap-data.json', { cache: 'no-cache' });
    if (resp.ok) REGISTRY = await resp.json();
  } catch(e) { /* use baked-in fallback */ }
  rCal();
  rProg();
}
```

New:
```js
async function loadRegistry() {
  try {
    const resp = await fetch('roadmap-data.json', { cache: 'no-cache' });
    if (resp.ok) REGISTRY = await resp.json();
  } catch(e) { /* use baked-in fallback */ }
  await loadSupabaseOverlay(cP);
  rCal();
  rProg();
}
```

### 4. Modify `setP()` (~line 6092) — add URL param + Supabase refresh

Add at end of function body before closing brace:
```js
const url = new URL(window.location);
url.searchParams.set('period', p);
history.replaceState(null, '', url);
loadSupabaseOverlay(p).then(() => { rCal(); rProg(); });
```

### 5. Read `?period=` on init (~line 6220-6222)

Before the existing `rCD();rCal();rProg();` init block, add:
```js
(function() {
  const params = new URLSearchParams(window.location.search);
  const p = (params.get('period') || '').toUpperCase();
  if (p === 'E') setP('E');
})();
```

### 6. Add Schoology sync status line in tooltip (`sTip()` ~line 6209)

After the existing `h+='<div class="tt-status ...'` line, add:
```js
if (re.periods && re.periods[cP] && re.periods[cP].syncStatus) {
  const ss = re.periods[cP].syncStatus;
  const label = ss === 'posted' ? 'Posted' : ss === 'taught' ? 'Taught' : 'Scheduled';
  h += '<div class="tt-status" style="color:#3b82f6">Schoology: ' + label + '</div>';
}
```

### 7. Add Schoology sync status in resource panel (`showResourcePanel()` ~line 3763)

After the existing Schoology folder link block, add:
```js
if (pInfo && pInfo.syncStatus) {
  const syncLabel = pInfo.syncStatus === 'posted' ? 'Posted'
    : pInfo.syncStatus === 'taught' ? 'Taught' : 'Scheduled';
  lessonHtml += '<div style="margin:3px 0;color:#3b82f6">Schoology: ' + syncLabel + '</div>';
}
```

## Do NOT touch
- The `S` array
- `BAKED_REGISTRY` content
- `RESOURCES` object
- Any CSS
- Sound effects, Doge, boot screen
- `lesson.status` derivation
