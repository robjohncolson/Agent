# Agent B: Roadmap HTML Enhancements

## Task
Modify `ap_stats_roadmap.html` to add registry awareness: fetch+fallback data loading,
link icons in day cells, enhanced tooltips, and status dot indicators.

## Owned File
- `C:/Users/ColsonR/apstats-live-worksheet/ap_stats_roadmap.html` (MODIFY)

## Changes Required

### 1. Add CSS (inside existing `<style>` block)

```css
/* Registry link icons */
.link-row { display:flex; gap:3px; justify-content:center; margin-top:2px; }
.link-row a {
  display:inline-block; width:16px; height:16px; text-decoration:none;
  font-size:11px; text-align:center; line-height:16px; opacity:0.7;
  border-radius:3px;
}
.link-row a:hover { opacity:1; background:rgba(255,255,255,0.2); }

/* Status dots */
.status-dot {
  position:absolute; bottom:3px; left:3px;
  width:6px; height:6px; border-radius:50%;
}
.status-ready { background:#4caf50; }
.status-partial { background:#ff9800; }

/* Tooltip enhancements */
.tt-links { margin-top:4px; font-size:11px; }
.tt-links a { color:#90caf9; margin-right:6px; }
.tt-status { margin-top:4px; font-size:11px; font-weight:600; }
.tt-status.ready { color:#4caf50; }
.tt-status.partial { color:#ff9800; }
.tt-status.pending { color:#888; }
.tt-schoology { margin-top:3px; font-size:11px; }
.tt-schoology a { color:#b0bec5; }
```

### 2. Add BAKED_REGISTRY placeholder + loadRegistry()

Add this BEFORE the SCHEDULE definition (before `const OFF = "off"`):

```javascript
// Registry data — injected by build-roadmap-data.mjs
const BAKED_REGISTRY = {};

let REGISTRY = BAKED_REGISTRY;

async function loadRegistry() {
  try {
    const resp = await fetch('roadmap-data.json', { cache: 'no-cache' });
    if (resp.ok) REGISTRY = await resp.json();
  } catch(e) { /* use baked-in fallback */ }
  renderCalendar();
  renderProgress();
}
```

Add `loadRegistry();` call after the initial `renderCalendar(); renderProgress(); renderCountdown();` block.

### 3. Helper function — getRegistryEntry()

Add after `loadRegistry`:
```javascript
function getRegistryEntry(topicKey) {
  if (!REGISTRY || !REGISTRY.lessons) return null;
  return REGISTRY.lessons[topicKey] || null;
}
```

### 4. Modify cellContent(info, ds)

After the existing topic-title div and double-badge, add link icons row.
The enhanced function should:
- Look up `getRegistryEntry(info.t)` (also handle `+` split for double topics)
- If entry exists and status !== "pending", render a `.link-row` div with icons:
  - `📄` → worksheet URL
  - `🎯` → drills URL
  - `📝` → quiz URL
  - `🟦` → blooket URL
- Only render icons for URLs that exist (non-null)
- Each icon is an `<a>` tag with `target="_blank"` and `title` attribute

### 5. Modify cell creation loop

After `cell.innerHTML = cellContent(info, ds);`, add status dot:
```javascript
const regEntry = getRegistryEntry(info.t);
if (regEntry) {
  if (regEntry.status === 'ready') {
    cell.style.position = 'relative';
    cell.insertAdjacentHTML('beforeend', '<span class="status-dot status-ready"></span>');
  } else if (regEntry.status === 'partial') {
    cell.style.position = 'relative';
    cell.insertAdjacentHTML('beforeend', '<span class="status-dot status-partial"></span>');
  }
}
```

### 6. Modify showTooltip()

After the existing tooltip content (topic + due/assign lines), add:
- Link list: clickable "Worksheet · Drills · Quiz · Blooket" links
- Status badge: "Ready ✓" / "Partial ◐" / "Pending ○"
- Schoology folder link based on `currentPeriod`

```javascript
const re = getRegistryEntry(info.t);
if (re) {
  // Links
  let links = '';
  if (re.urls.worksheet) links += '<a href="'+re.urls.worksheet+'" target="_blank">Worksheet</a>';
  if (re.urls.drills) links += '<a href="'+re.urls.drills+'" target="_blank">Drills</a>';
  if (re.urls.quiz) links += '<a href="'+re.urls.quiz+'" target="_blank">Quiz</a>';
  if (re.urls.blooket) links += '<a href="'+re.urls.blooket+'" target="_blank">Blooket</a>';
  if (links) h += '<div class="tt-links">' + links + '</div>';
  // Status
  const statusText = re.status === 'ready' ? 'Ready ✓' : re.status === 'partial' ? 'Partial ◐' : 'Pending ○';
  const statusClass = re.status;
  h += '<div class="tt-status ' + statusClass + '">' + statusText + '</div>';
  // Schoology folder
  const pInfo = re.periods && re.periods[currentPeriod];
  if (pInfo && pInfo.schoologyFolder) {
    h += '<div class="tt-schoology"><a href="'+pInfo.schoologyFolder+'" target="_blank">📁 Schoology Folder</a></div>';
  }
}
```

## Important Context
- `currentPeriod` is a global variable toggled between "B" and "E"
- `info.t` is the topic key (e.g., "6.6", "7.1", "review")
- For special types (OFF, NC, EX, POST, review), skip registry lookup
- The `d()` helper returns `{t, n, u, due, assign, dbl}` — use `info.t` for lookup
- Double topics use `+` separator (e.g., "6.4+6.5") — split and look up each
- `.day-cell` already has styles; add `position:relative` only when status dot needed
- The setInterval at the end already calls renderCalendar/renderProgress every 60s

## Acceptance Criteria
- `const BAKED_REGISTRY = {};` placeholder exists on its own line
- `loadRegistry()` fetches `roadmap-data.json` with `no-cache`
- Link icons appear only for lessons with available URLs
- Status dots (green/amber) appear in bottom-left of cells
- Tooltip shows clickable links, status badge, and Schoology folder link
- Double-topic days show links for both lessons
- No visual changes for OFF/NC/EX/POST/review cells
