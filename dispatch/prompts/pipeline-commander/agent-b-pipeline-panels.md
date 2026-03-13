# Agent B — Pipeline Steps + Log Viewer Panels

## Task
Create two blessed panel modules for the Pipeline Commander TUI.

Both modules must use ESM imports and follow this contract:
```js
import blessed from 'blessed';
import { COLORS, ICONS, STYLES, createBox } from '../theme.mjs';

// create(screen, data, theme) → blessed widget
// update(widget, data) → void
```

## File 1: `scripts/lib/commander/panels/pipeline-steps.mjs`

The left panel showing all 13 pipeline steps grouped by wave.

### `create(screen, data)`
- Create a blessed `box` with label `' Pipeline Steps '`, border, scrollable
- Position: `{ top: 1, left: 0, width: '50%', height: '70%' }`
- Render initial content via `update()`
- Return the box widget

### `update(widget, data)`
`data` has:
- `data.pipeline` — the pipeline definition with `.steps` array
- `data.registry` — the lesson registry (to check step status for current lesson)
- `data.waves` — precomputed wave groupings from `computeWaves()` (array of `{ wave, tasks }`)
- `data.currentLesson` — string like "7.3" (the selected lesson)

Render content as a string with:
1. A progress bar line: `▓` for done, `░` for pending. Example: `▓▓▓▓▓▓▓░░░░░ 58% (7/12)`
2. For each wave group, a header `Wave N` in bold
3. Under each wave, each task with status icon + name + elapsed time
   - Map task names to registry status keys: `ingest`→`ingest`, `content-gen-worksheet`→`worksheet`, `content-gen-blooket`→`blooketCsv`, `content-gen-drills`→`drills`, `render-animations`→`animations`, `upload-animations`→`animationUpload`, `upload-blooket`→`blooketUpload`, `schoology-post`→`schoology`, `verify-schoology`→`schoologyVerified`, `generate-urls`→`urlsGenerated`, `export-registry`→`registryExported`, `build-roadmap`→`registryExported`, `commit-push`→`committed`
   - Status icon: `done`→ICONS.done, `pending`→ICONS.pending, anything else→ICONS.running
4. Set `widget.setContent(content)`

## File 2: `scripts/lib/commander/panels/log-viewer.mjs`

The F4 log view — a scrollable log tail panel.

### `create(screen)`
- Create a blessed `log` widget (blessed has a built-in log element)
- Label: `' Pipeline Log '`
- Position: `{ top: 1, left: 0, width: '100%', height: '90%' }` (full-screen overlay)
- Scrollable, scrollbar, hidden by default (`widget.hide()`)
- Return the widget

### `update(widget, line)`
Append a single line to the log widget: `widget.log(line)`.

### `attachProcess(widget, childProcess)`
Given a Node `child_process` object, pipe its stdout and stderr lines into the log:
```js
childProcess.stdout.on('data', chunk => { ... split by newline, log each });
childProcess.stderr.on('data', chunk => { ... });
```

## Acceptance Criteria
- Both files parse: `node -e "import('./scripts/lib/commander/panels/pipeline-steps.mjs')"`
- `pipeline-steps.create()` returns a blessed box widget
- `pipeline-steps.update()` renders wave-grouped step list with status icons
- `log-viewer.create()` returns a blessed log widget (hidden by default)
- All exports are named ESM exports
