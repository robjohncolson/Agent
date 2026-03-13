# Spec: Square Mode Roadmap — Registry Integration (fetch+baked)

## Goal

Replace the `lesson-registry-data.js` sidecar in `ap_stats_roadmap_square_mode.html` with the same fetch+baked pattern used by `ap_stats_roadmap.html`. After `build-roadmap-data.mjs` runs, the square mode HTML is self-contained and auto-updates on next page load.

## Tasks

### Task A — Build Script: Inject into Square Mode HTML
**File**: `scripts/build-roadmap-data.mjs`
- Add `SQUARE_HTML` path constant pointing to `ap_stats_roadmap_square_mode.html`
- Duplicate the BAKED_REGISTRY injection block (lines 111–126) for the square mode HTML
- Same regex pattern, same output JSON

### Task B — Square Mode HTML: Full Registry Integration
**File**: `apstats-live-worksheet/ap_stats_roadmap_square_mode.html`

1. **Remove sidecar** — delete `<script src="lesson-registry-data.js"></script>` (line 923)
2. **Add CSS** — port `.link-row`, `.status-dot`, `.status-ready`, `.status-partial` from regular roadmap (lines 157–179)
3. **Add registry bootstrap** — insert `const BAKED_REGISTRY = {};` placeholder + `let REGISTRY = BAKED_REGISTRY;` + `loadRegistry()` + `getRegistryEntry()` / `getAllRegistryEntries()` (port from regular roadmap lines 1284–1316)
4. **Replace lookupRegistry()** — rewrite to use `getRegistryEntry()` with new registry shape (`REGISTRY.lessons[key]` instead of `LESSON_REGISTRY[key]`)
5. **Update showResourcePanel()** — read `entry.urls.worksheet` etc. directly (no `.status.worksheet === 'done'` check); use `entry.periods.B/E.schoologyFolder` for period-aware Schoology links
6. **Update htm()** — add link icons (📄🎯📝🟦) using `getAllRegistryEntries()` (port from regular roadmap lines 1385–1396)
7. **Update rCal()** — add status dots (green=ready, amber=partial) after cell creation (port from regular roadmap lines 1421–1433)
8. **Call loadRegistry()** at init (line ~4391)

## File Ownership
- Agent A owns: `scripts/build-roadmap-data.mjs`
- Agent B owns: `apstats-live-worksheet/ap_stats_roadmap_square_mode.html`

No overlap.

## Registry Shape (new, from roadmap-data.json)

```json
{
  "generatedAt": "...",
  "registryVersion": "...",
  "lessons": {
    "6.1": {
      "topic": "Intro to Inference",
      "urls": { "worksheet": "...", "drills": "...", "quiz": "...", "blooket": "..." },
      "status": "ready|partial|pending",
      "periods": {
        "B": { "date": "...", "schoologyFolder": "...", "posted": true, "verified": true },
        "E": { "date": "...", "schoologyFolder": "...", "posted": false, "verified": false }
      }
    }
  }
}
```

## Old Registry Shape (lesson-registry-data.js sidecar)

```json
LESSON_REGISTRY = {
  "6.1": {
    "urls": { "worksheet": "...", "drills": "...", "quiz": "...", "blooket": "...", "schoologyFolder": "...", "schoologyFolderE": "..." },
    "status": { "worksheet": "done", "drills": "done", "blooketUpload": "done" }
  }
}
```

## Acceptance Criteria
- `node scripts/build-roadmap-data.mjs` prints "Injected BAKED_REGISTRY into ap_stats_roadmap_square_mode.html"
- Square mode HTML has no `<script src="lesson-registry-data.js">` tag
- Cells show link icons (📄🎯📝🟦) for lessons with resources
- Cells show status dots (green=ready, amber=partial)
- Resource panel shows correct links using new registry shape
- Period B/E toggle switches Schoology folder links
