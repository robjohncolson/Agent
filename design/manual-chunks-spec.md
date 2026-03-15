# Manual Chunks + Dynamic Imports — Spec

## Current State
Main bundle: 364 KB (single file, all modules)

## Strategy

### Agent 1: vite.config.js — manualChunks
Split graph-engine into its own chunk. It's 77KB source (~35KB minified) and imported
synchronously by platform.js, so it can't be lazy-loaded. But a separate chunk means:
- Browser downloads it in parallel with the main chunk
- Changes to graph-engine don't bust the main app cache
- Smaller initial parse unit

### Agent 2: app.html — dynamic imports for conditionally-used modules
Convert 3 module groups from static to dynamic imports:

1. **WebRTCManager** (14KB) — only instantiated inside WebSocket message handler
2. **P2PAssetTransfer** (14KB) + **SyncQueue** (12KB) — only created when WS connects
3. **RosterModal** (20KB) — only created when teacher mode activates

These modules are never used by regular students doing drills. Dynamic import means
they're only fetched when actually needed (~46KB deferred).

**Not candidates for lazy-load (used at startup):**
- AssetCache (4KB) — constructed at line 1373
- AssetResolver (10KB) — constructed at line 1374

## Expected Results
- Main bundle: ~364KB → ~280KB (graph-engine split + 3 modules deferred)
- graph-engine chunk: ~35KB (loaded in parallel, cached independently)
- webrtc chunk: ~25KB (loaded only on multiplayer)
- roster chunk: ~10KB (loaded only for teachers)

## Dependency Graph
```
Agent 1: vite.config.js (manualChunks)     — independent
Agent 2: platform/app.html (dynamic imports) — independent
```
Single wave, full parallel.
