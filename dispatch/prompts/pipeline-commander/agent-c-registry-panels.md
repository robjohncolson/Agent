# Agent C — Lesson Detail + Registry Overview Panels

## Task
Create two blessed panel modules for the Pipeline Commander TUI.

Both modules must use ESM imports and follow this contract:
```js
import blessed from 'blessed';
import { COLORS, ICONS, STYLES, createBox } from '../theme.mjs';
```

## File 1: `scripts/lib/commander/panels/lesson-detail.mjs`

The right panel showing details for the currently selected lesson.

### `create(screen)`
- Create a blessed `box` with label `' Lesson Detail '`, border, scrollable
- Position: `{ top: 1, left: '50%', width: '50%', height: '70%' }`
- Return the box widget

### `update(widget, data)`
`data` has:
- `data.lesson` — a single registry entry object (may be null if nothing selected)
- `data.period` — `'B'` or `'E'` (active period toggle)
- `data.animations` — animation uploads state
- `data.blooket` — blooket uploads array

If `data.lesson` is null, show "No lesson selected".

Otherwise render:
```
Topic {unit}.{lesson} — {topic}
─────────────────────────────
Status: {ICONS.ready|partial|empty} {status_word}

URLs
  📄 Worksheet    {✅ url | ⬜ —}
  🎯 Drills       {✅ url | ⬜ —}
  📝 Quiz         {✅ url | ⬜ —}
  🟦 Blooket      {✅ url | ⬜ —}

Period B
  📁 Schoology    {✅ linked | ⬜ —}
  📮 Posted       {✅ N materials | ⬜ not yet}
  ✓  Verified     {date | —}

Period E
  📁 Schoology    {✅ linked | ⬜ —}
  📮 Posted       {✅ N materials | ⬜ not yet}
  ✓  Verified     {date | —}

Animations: {count} scenes uploaded
Content hash: {hash | —}
```

The registry entry shape:
```json
{
  "unit": 6, "lesson": 10, "topic": "...", "date": "...",
  "urls": { "worksheet": "...", "drills": "...", "quiz": "...", "blooket": "...",
            "schoologyFolder": "...", "schoologyFolderE": "...", "videos": [...] },
  "status": { "ingest": "done", "worksheet": "done", ... },
  "schoology": {
    "B": { "folderId": "...", "verifiedAt": "...", "materials": { "worksheet": {...}, ... } },
    "E": { ... }
  }
}
```

Determine overall status:
- `ready` if ALL of: worksheet, drills, schoology, schoologyVerified are "done"
- `partial` if ingest is "done" but not all above
- `pending` otherwise

Count posted materials by counting keys in `schoology.{period}.materials` object.

## File 2: `scripts/lib/commander/panels/registry-overview.mjs`

The bottom panel showing compact status dots per lesson, per unit.

### `create(screen)`
- Create a blessed `box` with label `' Registry Overview '`, border
- Position: `{ top: '70%', left: 0, width: '100%', height: '20%' }`
- Return the box widget

### `update(widget, data)`
`data` has:
- `data.registry` — full registry object (keyed by topic string like "6.10")
- `data.selectedTopic` — string like "7.3" (highlight this one)

Group lessons by unit. For each unit, render one row:
```
U6  6.1 ● 6.2 ● 6.3 ● 6.4 ● 6.5 ● 6.6 ● 6.7 ● 6.8 ● 6.9 ◐ 6.10 ◐ 6.11 ◐
U7  7.1 ● 7.2 ● 7.3 ◐ 7.4 ○ ...
```

Status dot logic (same as lesson-detail):
- `●` (ICONS.ready) = ready
- `◐` (ICONS.partial) = partial
- `○` (ICONS.empty) = pending

Color the dots: ready=green, partial=yellow, pending=gray.
Highlight selected topic with `{bold}` tags.

After all unit rows, add a summary line:
```
● ready (N)   ◐ partial (N)   ○ pending (N)        N total lessons
```

### `getTopics(registry)`
Export a helper that returns sorted topic list: `['6.1', '6.2', ..., '9.6']`.
Sort by unit (number), then lesson (number).

## Acceptance Criteria
- Both files parse without errors
- lesson-detail renders all sections from registry entry data
- registry-overview renders one row per unit with correct status dots
- `getTopics()` returns sorted array of topic strings
