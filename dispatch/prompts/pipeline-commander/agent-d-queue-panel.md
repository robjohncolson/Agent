# Agent D — Work Queue Panel

## Task
Create a blessed panel module for the work queue display in the Pipeline Commander TUI.

Use ESM imports:
```js
import blessed from 'blessed';
import { COLORS, ICONS, STYLES, createBox } from '../theme.mjs';
```

## File: `scripts/lib/commander/panels/work-queue.mjs`

This panel has two modes:
1. **Strip mode** — a single-line footer showing queue progress (always visible)
2. **Expanded mode** — a full table replacing the left panel (toggled by F2)

### `createStrip(screen)`
- Create a blessed `box` (no border, single line)
- Position: `{ bottom: 1, left: 0, width: '100%', height: 1 }`
- Return the widget

### `updateStrip(widget, data)`
`data.queue` has: `{ version, lastRun, stats: { total, completed, pending, ... }, actions: [...] }`

Render a single line:
```
▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░ 34% complete (102/300)  Next: ingest 7.4 → 7.5 → 7.6 → ...
```

Progress bar: 30 chars wide. `▓` = completed fraction, `░` = remaining.
"Next" shows the first 5 pending actions (status !== 'completed') sorted by unit+lesson.

### `createExpanded(screen)`
- Create a blessed `listtable` widget
- Label: `' Work Queue '`, border, scrollable
- Position: `{ top: 1, left: 0, width: '50%', height: '70%' }` (same as pipeline-steps)
- Hidden by default (`widget.hide()`)
- Return the widget

### `updateExpanded(widget, data)`
`data.queue.actions` is an array of:
```json
{
  "id": "6.4-ingest",
  "unit": 6, "lesson": 4,
  "type": "ingest",
  "status": "completed",
  "completedAt": "2026-03-11T...",
  ...
}
```

Render as a table with columns: `Unit`, `Lesson`, `Type`, `Status`.
Sort by: status (pending first, then completed), then unit, then lesson.
Color completed rows dim, pending rows bright.

### `getNextPending(actions, limit = 5)`
Return the first `limit` actions where status !== 'completed', sorted by unit then lesson.
Export this as a named function.

## Acceptance Criteria
- File parses: `node -e "import('./scripts/lib/commander/panels/work-queue.mjs')"`
- `createStrip()` returns a 1-line box widget
- `createExpanded()` returns a hidden listtable widget
- `updateStrip()` renders progress bar + next pending
- `updateExpanded()` renders sortable action table
- `getNextPending()` returns correct sorted subset
