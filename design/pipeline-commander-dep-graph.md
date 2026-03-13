# Pipeline Commander — Dependency Graph

## Agents

| ID | Name | Files | Executor | Est |
|----|------|-------|----------|-----|
| A | foundation | `scripts/lib/commander/theme.mjs`, `scripts/lib/commander/data-loader.mjs` | Codex | M |
| B | pipeline-panels | `scripts/lib/commander/panels/pipeline-steps.mjs`, `scripts/lib/commander/panels/log-viewer.mjs` | Codex | M |
| C | registry-panels | `scripts/lib/commander/panels/lesson-detail.mjs`, `scripts/lib/commander/panels/registry-overview.mjs` | Codex | M |
| D | queue-panel | `scripts/lib/commander/panels/work-queue.mjs` | Codex | S |
| E | integration | `scripts/lib/commander/keybindings.mjs`, `scripts/pipeline-commander.mjs` | CC-direct | L |

## Waves

```
Wave 1: Agent A (foundation — theme + data-loader)
Wave 2: Agent B, Agent C, Agent D (all panels — parallel, depend on A)
Wave 3: Agent E (keybindings + entry point — CC-direct, depends on B+C+D)
```

## Contracts

### Agent A → All panels
- `theme.mjs` exports: `COLORS`, `STYLES`, `ICONS`, `createBox(screen, opts)`
- `data-loader.mjs` exports: `loadAll(basePath)` → `{ registry, queue, pipeline, schedule, animations, blooket }`, `watchAll(basePath, onChange)`

### Panels → Agent E
Each panel module exports:
- `create(screen, data, theme)` → blessed widget (positioned by caller)
- `update(widget, data)` → void (refreshes content in-place)
