# Agent A — Foundation (theme + data-loader)

## Task
Create two foundation modules for a `blessed`-based TUI dashboard.

## File 1: `scripts/lib/commander/theme.mjs`

Export an object-based theme module with these named exports:

### `COLORS`
```js
export const COLORS = {
  bg: '#000080',        // deep blue background
  border: 'cyan',       // panel borders
  header: 'white',      // header text
  ready: 'green',       // status: ready
  partial: 'yellow',    // status: partial
  pending: 'gray',      // status: pending
  error: 'red',         // status: failed
  selected: 'white',    // selected row bg
  fnBar: 'cyan',        // function key bar bg
  fnKey: 'black',       // function key text
};
```

### `ICONS`
```js
export const ICONS = {
  done: '✅', running: '⏳', pending: '⬜', failed: '❌', skipped: '⏭️',
  ready: '●', partial: '◐', empty: '○',
  worksheet: '📄', drills: '🎯', quiz: '📝', blooket: '🟦',
  folder: '📁', posted: '📮',
};
```

### `STYLES`
A `STYLES` object with blessed-compatible style objects for: `panel` (standard bordered box), `header` (bold header), `selected` (inverse highlight), `fnBar` (function key bar). Each should use the COLORS values above.

### `createBox(screen, opts)`
A helper that creates a `blessed.box(...)` pre-configured with the panel style (border, colors) and merges in caller `opts` (top, left, width, height, label, etc). Returns the box widget.

## File 2: `scripts/lib/commander/data-loader.mjs`

Export functions that read the TUI's data sources from disk.

### `loadAll(basePath)`
Reads these JSON files relative to `basePath`:
- `state/lesson-registry.json` → key: `registry` (object keyed by topic like "6.10")
- `state/work-queue.json` → key: `queue` (has `.actions` array, `.stats` object)
- `pipelines/lesson-prep.json` → key: `pipeline` (has `.steps` array)
- `config/topic-schedule.json` → key: `schedule`
- `state/animation-uploads.json` → key: `animations`
- `state/blooket-uploads.json` → key: `blooket` (array of upload objects)

Return `{ registry, queue, pipeline, schedule, animations, blooket }`.
Use `JSON.parse(fs.readFileSync(..., 'utf8'))` with a try/catch that returns `null` for missing files.

### `watchAll(basePath, onChange)`
Use `fs.watch` on the `state/` directory. On any change, call `onChange()` (debounced to 500ms).
Return a cleanup function that closes the watcher.

### `computeWaves(pipeline)`
Given the pipeline definition, compute wave groupings from the dependency graph.
Algorithm: topological sort by `depends_on`. Tasks with no unresolved deps go in the current wave.

Return `Array<{ wave: number, tasks: string[] }>`:
```js
[
  { wave: 1, tasks: ['ingest'] },
  { wave: 2, tasks: ['content-gen-worksheet', 'content-gen-blooket', 'content-gen-drills'] },
  // ...
]
```

## Acceptance Criteria
- Both files parse without errors: `node -e "import('./scripts/lib/commander/theme.mjs')"`
- `loadAll` returns all 6 keys when files exist, `null` for missing
- `computeWaves` returns correct wave groupings for the 13-step pipeline
- All exports use ESM (`export function`, `export const`)
