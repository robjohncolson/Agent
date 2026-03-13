# Spec: Pipeline Commander — TUI Dashboard for Lesson Prep

## Goal

A Midnight Commander-style terminal UI that gives a single-screen view of the entire lesson-prep pipeline: registry state, pipeline steps, work queue, and Schoology posting status. Runs in PowerShell via `node scripts/pipeline-commander.mjs`.

## Visual Layout

```
┌─ Pipeline Commander ──────────────────────────────────────────────────────────────┐
│  AP Stats Lesson Prep Pipeline          Period: [B]  ◄►  E     12:34 PM  Mar 13  │
├─── Pipeline Steps ─────────────────────┬─── Lesson Detail ────────────────────────┤
│                                        │                                          │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░ 68% (8/12)    │  Topic 7.3 — Justify Claims (μ CI)      │
│                                        │  ─────────────────────────────────       │
│  Wave 1                                │  Status: ● partial                       │
│    ✅ ingest              00:12        │                                          │
│  Wave 2                                │  URLs                                    │
│    ✅ content-gen-ws      01:45        │    📄 Worksheet    ✅ https://docs...     │
│    ✅ content-gen-blk     01:22        │    🎯 Drills       ✅ https://docs...     │
│    ✅ content-gen-drills  01:38        │    📝 Quiz         ⬜ —                   │
│  Wave 3                                │    🟦 Blooket      ⬜ —                   │
│    ✅ render-animations   02:15        │                                          │
│  Wave 4                                │  Period B                                │
│    ✅ upload-animations   00:34        │    📁 Schoology    ✅ linked              │
│    ✅ upload-blooket      00:28        │    📮 Posted       ✅ 3 materials         │
│  Wave 5                                │    ✓  Verified     2026-03-11            │
│    ⬜ schoology-post      —            │                                          │
│  Wave 6                                │  Period E                                │
│    ⬜ verify-schoology    —            │    📁 Schoology    ✅ linked              │
│    ⬜ generate-urls       —            │    📮 Posted       ⬜ not yet             │
│  Wave 7                                │    ✓  Verified     —                     │
│    ⬜ export-registry     —            │                                          │
│    ⬜ build-roadmap       —            │  Animations: 4 scenes uploaded           │
│    ⬜ commit-push         —            │  Content hash: 58046362fbd7              │
│                                        │                                          │
├─── Registry Overview ──────────────────┴──────────────────────────────────────────┤
│                                                                                   │
│  U6  6.1 ● 6.2 ● 6.3 ● 6.4 ● 6.5 ● 6.6 ● 6.7 ● 6.8 ● 6.9 ◐ 6.10 ◐ 6.11 ◐  │
│  U7  7.1 ● 7.2 ● 7.3 ◐ 7.4 ○ 7.5 ○ 7.6 ○ 7.7 ○ 7.8 ○ 7.9 ○                  │
│  U8  8.1 ○ 8.2 ○ 8.3 ○ 8.4 ○ 8.5 ○ 8.6 ○                                      │
│  U9  9.1 ○ 9.2 ○ 9.3 ○ 9.4 ○ 9.5 ○ 9.6 ○                                      │
│                                                                                   │
│  ● ready (12)   ◐ partial (6)   ○ pending (26)        44 total lessons           │
│                                                                                   │
├─── Work Queue ────────────────────────────────────────────────────────────────────┤
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░ 34% complete (102/300)                          │
│  Next: ingest 7.4 → 7.5 → 7.6 → 7.7 → 7.8 → 7.9 → 8.1 → ...                   │
├───────────────────────────────────────────────────────────────────────────────────┤
│ F1 Help  F2 Queue  F3 View  F4 Logs  F5 Run  F6 Period  F8 Rebuild  F10 Quit    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## Panels

### Top Bar
- Title, active period toggle (B/E), clock, date
- Period toggle via `F6` or `←`/`→` arrows

### Left Panel — Pipeline Steps (scrollable)
- Shows all 13 steps from `pipelines/lesson-prep.json` grouped by wave
- Each step: status icon + name + elapsed time (if run)
- Status icons: `✅` done, `⏳` running, `⬜` pending, `❌` failed, `⏭️` skipped
- Progress bar at top: aggregate completion
- Highlight active step with inverse colors
- Data source: task runner state (in-memory during run, or last-run cache)

### Right Panel — Lesson Detail (context-sensitive)
- Shows detail for the currently selected lesson in the registry overview
- Navigate with `↑`/`↓` in the registry row or type a topic code (e.g., `7.3`)
- Sections:
  - **Status** — ready/partial/pending with colored dot
  - **URLs** — worksheet, drills, quiz, blooket (✅ if present, ⬜ if missing)
  - **Period B/E** — Schoology folder link, posted count, verified date
  - **Animations** — scene count from `state/animation-uploads.json`
  - **Content hash** — from registry entry

### Bottom Panel — Registry Overview (compact)
- One row per unit, each lesson as a status dot: `●` ready, `◐` partial, `○` pending
- Summary counts at bottom
- Arrow keys or click to select a lesson → updates right panel
- Data source: `state/lesson-registry.json`

### Footer — Work Queue Strip
- Single-line progress bar + next pending actions from `state/work-queue.json`
- `F2` expands into full queue view (replaces left panel temporarily)

### Function Key Bar
| Key | Action |
|-----|--------|
| F1 | Help overlay — keybindings, data sources, pipeline diagram |
| F2 | Toggle work queue expanded view |
| F3 | View raw JSON for selected lesson (scrollable overlay) |
| F4 | Tail pipeline log output (live stream during run) |
| F5 | Run pipeline: prompts for unit+lesson, then `node scripts/lesson-prep.mjs --auto --unit X --lesson Y` |
| F6 | Toggle period B ↔ E |
| F8 | Rebuild roadmap data (`node scripts/build-roadmap-data.mjs`) — refreshes in-place |
| F10 | Quit |

## Data Sources (read-only)

| File | What it provides |
|------|-----------------|
| `state/lesson-registry.json` | All lesson entries, URLs, status, Schoology data |
| `state/work-queue.json` | Pending/completed actions, progress counts |
| `config/topic-schedule.json` | Per-period date assignments |
| `pipelines/lesson-prep.json` | Step definitions, dependency graph, wave structure |
| `state/animation-uploads.json` | Upload manifest for animation scenes |
| `state/blooket-uploads.json` | Blooket upload state |
| `state/cross-agent-log.json` | Agent dispatch history (for log viewer) |

## Tech Stack

- **Runtime**: Node.js (already in the stack, no new deps for the user)
- **TUI library**: [blessed](https://github.com/chjj/blessed) or [blessed-contrib](https://github.com/yaronn/blessed-contrib) — mature, works in PowerShell/ConPTY, supports box drawing, colors, mouse events, scrolling
- **Alternative**: [ink](https://github.com/vadimdemedes/ink) (React for CLI) — simpler component model but less MC-like
- **Recommended**: `blessed` — closest to the MC aesthetic with full box drawing, function key bar, and dual-pane layout
- **Entry point**: `scripts/pipeline-commander.mjs`

## Interaction Model

1. **Launch**: `node scripts/pipeline-commander.mjs` — loads all state files, renders
2. **Browse**: Arrow keys navigate the registry overview row; selected lesson populates right panel
3. **Run**: `F5` → mini-prompt asks `Unit? Lesson?` → spawns pipeline as child process → left panel live-updates step status, F4 shows log stream
4. **Rebuild**: `F8` → runs `build-roadmap-data.mjs` inline → flashes "Rebuilt" confirmation → refreshes registry overview
5. **Auto-refresh**: File watcher on `state/lesson-registry.json` — if it changes on disk (e.g., another terminal ran a script), panels refresh automatically

## Views (switchable with F2/F3)

| View | Layout |
|------|--------|
| **Main** (default) | Pipeline steps (left) + Lesson detail (right) + Registry overview (bottom) |
| **Queue** (F2) | Full work queue table (left) + Lesson detail (right) — sortable by unit, status, action type |
| **Raw** (F3) | Full-screen JSON viewer for selected entry — scrollable, syntax-highlighted |
| **Log** (F4) | Full-screen log tail — live during pipeline run, scrollable history after |

## Color Scheme (MC-inspired)

- Background: deep blue (`#000080`)
- Panel borders: cyan box-drawing characters
- Headers: white bold on blue
- Status ready: bright green
- Status partial: yellow/amber
- Status pending: dim gray
- Selected row: inverse (white bg, black text)
- Function key bar: black on cyan
- Error/failed: bright red

## Stretch Goals (not v1)

- **Mouse support** — click lessons in registry overview, click function keys
- **Pipeline dry-run mode** — show what _would_ run without executing
- **Diff view** — show what changed since last build (registry delta)
- **Schoology tree viewer** — browse the Schoology folder structure from `state/schoology-tree.json`
- **Export** — `F9` exports a plain-text status report to clipboard

## File Structure

```
scripts/pipeline-commander.mjs          # Entry point + main layout
scripts/lib/commander/                   # TUI components
  panels/pipeline-steps.mjs             # Left panel
  panels/lesson-detail.mjs              # Right panel
  panels/registry-overview.mjs          # Bottom panel
  panels/work-queue.mjs                 # Queue expanded view
  panels/log-viewer.mjs                 # F4 log tail
  theme.mjs                             # Color scheme + box styles
  data-loader.mjs                       # Reads all state files + file watcher
  keybindings.mjs                       # Function key + navigation handlers
```

## Non-Goals

- This is **read-only + run-trigger** — it does not edit registry entries or queue items directly
- No web server, no browser — pure terminal
- No authentication or multi-user — single teacher workstation tool
