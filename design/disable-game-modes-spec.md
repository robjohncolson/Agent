# Disable Game Modes — WebGL Context Conflict Fix

## Problem

The LRSL Driller app freezes after a few interactions. Console shows:

```
canEnter=true
114 WebGL: INVALID_OPERATION: bindBuffer: object does not belong to this context
28  WebGL: INVALID_OPERATION: vertexAttribPointer: no ARRAY_BUFFER is bound and offset is non-zero
38  WebGL: INVALID_OPERATION: bindFramebuffer: object does not belong to this context
38  WebGL: INVALID_OPERATION: framebufferTexture2D: no framebuffer bound
38  WebGL: INVALID_OPERATION: drawElements: no buffer is bound to enabled attribute
gpgpu_util.js:173  WebGL: too many errors, no more errors will be reported to the console
[Ghost] Trained on interaction #4, proficiency: 50.0% (orange)
```

## Root Cause

Multiple WebGL context consumers fight for GPU resources:

1. **TensorFlow.js** (`@tensorflow/tfjs@4.17.0`) — uses `webgl` backend by default for neural network training (`gpgpu_util.js` is part of `@tensorflow/tfjs-backend-webgl`)
2. **Three.js** (`three@0.159.0`) — imported by `ghost-panel.js`, `ghost-maze-renderer.js`, `ghost-terrain-renderer.js` for 3D visualizations
3. **Canvas contexts** — Ghost Orbits renderer, game mode renderers use 2D canvas

Browsers limit concurrent WebGL contexts (typically 8-16). When exceeded, older contexts lose their GPU resources, causing "object does not belong to this context" errors. TF.js's WebGL compute tensors become invalid, the training loop throws, and the UI thread locks up.

## Fix Strategy

Disable all game modes and eliminate WebGL context conflicts:

### Step 1: Force TF.js CPU Backend (`ghost-engine.js`)
- After loading TensorFlow.js, call `tf.setBackend('cpu')` before any model operations
- The Ghost neural network is tiny (516 params) — CPU is more than adequate
- This eliminates TF.js's WebGL context entirely

### Step 2: Disable Three.js Renderers (`ghost-panel.js`)
- Skip MazeRenderer and TerrainRenderer initialization
- Hide the 3D visualization containers
- Replace with static placeholder text ("3D visualization disabled")
- This eliminates Three.js's WebGL contexts

### Step 3: Disable Game Mode UI & Controller (`app.html`)
- Comment out GhostOrbitsController import
- Make `initGhostOrbits()` a no-op
- Make `launchGhostOrbits()` return false with a console message
- Make `canEnterGhostOrbits()` return false
- Hide the game mode selector and play buttons in the Ghost Panel

## Files Modified

| File | Change | WebGL Contexts Eliminated |
|------|--------|--------------------------|
| `platform/core/ghost-engine.js` | Force CPU backend after TF.js load | TF.js WebGL backend |
| `platform/game/ghost-panel.js` | Skip 3D renderer init, hide game UI | Three.js (maze + terrain) |
| `platform/app.html` | Disable game controller, no-op launchers | Canvas game modes |

## What Still Works

- Ghost AI training (CPU backend — same accuracy, slightly slower but imperceptible for 516 params)
- Ghost proficiency tracking and color updates
- Ghost panel My Ghost tab (fractal pattern uses Canvas 2D, not WebGL)
- All cartridge functionality (problems, grading, stars, progression)
- Multiplayer WebSocket connections (if server is up)

## What Gets Disabled

- Ghost Orbits arena (all modes: Arena, Trails, Blizzard)
- 3D Maze visualization (Three.js WebGL)
- 3D Terrain landscape (Three.js WebGL)
- Game mode selector UI
- Enter Arena / Multiplayer buttons
