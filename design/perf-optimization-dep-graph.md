# Performance Optimization — Dependency Graph

## Agents & File Ownership

```
Agent A: platform/app.html (Steps 1, 5, 6, 8)
  - Dynamic-import GhostPanel
  - Batch DOM creation in populateCartridgeList
  - Reduce server detection timeout
  - Preload registry.json

Agent B: platform/core/input-renderer.js (Step 3)
  - Lazy-load RadicalGame variants

Agent C: platform/core/cartridge-loader.js (Step 4)
  - Parallelize network requests after manifest

Agent D: package.json + vite.config.js (Steps 2, 7)
  - Remove three + @tensorflow/tfjs deps
  - Add Vite manual chunks config
```

## Waves

```
Wave 1 (all parallel — different files):
  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐
  │ Agent A       │  │ Agent B           │  │ Agent C               │
  │ app.html      │  │ input-renderer.js │  │ cartridge-loader.js   │
  │ Steps 1,5,6,8│  │ Step 3            │  │ Step 4                │
  └──────┬───────┘  └──────────────────┘  └──────────────────────┘
         │
         ▼
Wave 2 (after Agent A completes):
  ┌──────────────┐
  │ Agent D       │
  │ package.json  │
  │ vite.config   │
  │ Steps 2, 7   │
  └──────────────┘
```

Agent D depends on Agent A because:
- Step 2 (remove deps) must happen after dynamic import is in place
- Step 7 (Vite chunks) references the dynamic import pattern from Step 1
