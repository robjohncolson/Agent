# LRSL Driller — Performance & Responsiveness Spec

## Current State (post-WebGL fix)

| Chunk | Size | Status |
|-------|------|--------|
| `app-*.js` | **574 KB** | Main bundle — everything |
| `three.module-*.js` | **466 KB** | Three.js — **100% unused** |
| `mathViz-*.js` | 97 KB | Standalone page (separate entry) |
| `app-*.css` | 65 KB | Tailwind — normal |
| `ghost-orbits-audio-*.js` | 7 KB | Dynamic import (fine) |
| **Total JS parsed on load** | **~1,040 KB** | |

Three.js alone is 45% of all JS. The app is a math drill tool — it needs none of this.

---

## Phase 1: Remove Dead Weight (estimated -500 KB)

### Step 1: Remove Three.js dependency and static GhostPanel import

**Problem:** `ghost-panel.js:9` does `import * as THREE from 'three'`, and `app.html:1023` statically imports GhostPanel. Vite bundles the entire Three.js library (466 KB) even though:
- MazeRenderer is disabled (returns null)
- TerrainRenderer is disabled (returns null)
- Ghost button is hidden (`display: none`)

**Fix:** Convert GhostPanel to a dynamic import. Since the ghost button is hidden and ghost-engine is a no-op, GhostPanel will never actually load — removing 466 KB + ~200 KB of ghost game modules from the critical path.

**Files:**
- `platform/app.html:1023` — change static import to dynamic
- `platform/app.html:1425-1510` — wrap initGhostPanel/toggleGhostPanel in lazy loader
- `package.json` — remove `"three"` and `"@tensorflow/tfjs"` from dependencies

**Savings:** ~500 KB (466 KB Three.js + ghost panel + maze/terrain/battle renderers + orbits-nn-mapper + orbits-lobby + multiplayer-client)

### Step 2: Remove @tensorflow/tfjs from package.json

**Problem:** Still listed in `package.json:14`. Even though ghost-engine is a no-op and ghost-network uses lazy init (`let tf = null`), Vite may still resolve the dependency.

**Fix:** Remove from package.json, run `npm install`.

**Savings:** Prevents accidental re-bundling. May save a few KB if Vite was including any TF.js shims.

---

## Phase 2: Code-Split Conditionally-Used Modules (estimated -64 KB)

### Step 3: Lazy-load RadicalGame variants in InputRenderer

**Problem:** `input-renderer.js:7-9` statically imports three visual game modules:
```javascript
import { RadicalGame } from './radical-game.js';           // ~20 KB
import { RadicalPrimeGame } from './radical-prime-game.js'; // ~20 KB
import { RadicalComplexGame } from './radical-complex-game.js'; // ~24 KB
```
These are only used when a problem has `type: 'visual-radical'` — most cartridges never use them.

**Fix:** Convert to dynamic imports inside the method that creates visual radical fields:
```javascript
async createVisualRadical(fieldId, schema) {
  const { RadicalComplexGame } = await import('./radical-complex-game.js');
  // ...
}
```

**Files:**
- `platform/core/input-renderer.js:7-9` — remove static imports
- `platform/core/input-renderer.js` — find visual-radical creation methods, add dynamic import

**Savings:** ~64 KB removed from main bundle (loaded on-demand only for radical cartridges)

---

## Phase 3: Faster Startup Path (estimated -200-400ms)

### Step 4: Parallelize CartridgeLoader network requests

**Problem:** `cartridge-loader.js` loads files sequentially:
```
await loadJSON(manifest.json)     // wait...
await loadJSON(contexts.json)     // then wait...
await loadModule(generator.js)    // then wait...
await loadModule(grading-rules.js) // then wait...
```
Each request is ~50-100ms. Total: 200-400ms serialized.

**Fix:** Load manifest first (needed to know other paths), then parallelize the rest:
```javascript
const manifest = await this.loadJSON(`${path}/manifest.json`);
const [contexts, generator, gradingRules] = await Promise.all([
  this.loadJSON(`${path}/${manifest.contexts}`),
  this.loadModule(`${path}/${manifest.generator}`),
  manifest.grading?.rubricFile ? this.loadModule(`${path}/${manifest.grading.rubricFile}`) : null
]);
```

**Files:**
- `platform/core/cartridge-loader.js:72-120` — restructure to Promise.all after manifest

**Savings:** 100-200ms on every cartridge load (initial + cartridge switch)

### Step 5: Batch DOM creation in populateCartridgeList

**Problem:** Creates ~19 cartridge buttons with individual `appendChild()` calls, each triggering layout recalculation.

**Fix:** Use DocumentFragment for batch insertion:
```javascript
const fragment = document.createDocumentFragment();
for (const cart of cartridges) {
  const btn = document.createElement('button');
  btn.innerHTML = `...`;
  fragment.appendChild(btn);
}
listEl.appendChild(fragment); // single reflow
```

**Files:**
- `platform/app.html` — find populateCartridgeList function, add fragment batching

**Savings:** ~50-100ms on initial load (eliminates 19 reflows → 1)

### Step 6: Reduce server detection timeout

**Problem:** `app.html:1044` has a 2-second timeout for Railway server detection. If Railway is down, startup stalls for 2 full seconds before falling back to local.

**Fix:** Reduce to 1 second. Railway either responds in <200ms or it's down.

**Files:**
- `platform/app.html:1044` — change `setTimeout(() => controller.abort(), 2000)` to `1000`

**Savings:** Up to 1 second when Railway is unreachable

---

## Phase 4: Vite Build Optimization (estimated -50-100 KB)

### Step 7: Add manual chunk splitting to vite.config.js

**Problem:** No code splitting configured. Everything goes into one 574 KB bundle.

**Fix:** Add rollupOptions output config:
```javascript
build: {
  rollupOptions: {
    input: { ... },
    output: {
      manualChunks: {
        // Separate ghost/game code (only loaded if ghost panel opens)
        'ghost': [
          'platform/game/ghost-panel.js',
          'platform/core/ghost-maze-renderer.js',
          'platform/core/ghost-terrain-renderer.js',
          'platform/core/ghost-battle-viz.js',
          'platform/core/ghost-orbits-nn-mapper.js'
        ],
        // Separate graph engine (loaded with first graph problem)
        'graph': ['platform/core/graph-engine.js']
      }
    }
  }
}
```

**Files:**
- `vite.config.js:236-243`

**Savings:** Splits the main bundle into smaller chunks that load on demand. Combined with Step 1 (dynamic GhostPanel import), the ghost chunk never loads at all.

---

## Phase 5: Preload Critical Assets (estimated -100ms)

### Step 8: Preload cartridge registry

**Problem:** `registry.json` is fetched by JS after the module graph finishes loading. The browser could start fetching it earlier.

**Fix:** Add to `<head>` in app.html:
```html
<link rel="preload" href="/cartridges/registry.json" as="fetch" crossorigin>
```

**Files:**
- `platform/app.html` — add preload link in `<head>`

**Savings:** ~50-100ms (registry fetch starts during JS parse instead of after)

---

## Summary

| Phase | Step | Change | Bundle Savings | Load Time Savings |
|-------|------|--------|---------------|-------------------|
| 1 | 1 | Dynamic-import GhostPanel | **-500 KB** | -200ms parse |
| 1 | 2 | Remove TF.js + Three.js deps | cleanup | prevents regress |
| 2 | 3 | Lazy-load RadicalGame variants | **-64 KB** | -50ms parse |
| 3 | 4 | Parallelize cartridge loading | 0 | **-100-200ms** |
| 3 | 5 | Batch DOM creation | 0 | **-50-100ms** |
| 3 | 6 | Reduce server timeout | 0 | **-1s** (when down) |
| 4 | 7 | Vite manual chunks | structural | on-demand loading |
| 5 | 8 | Preload registry.json | 0 | **-50-100ms** |
| | | **TOTAL** | **~564 KB** | **~400-600ms** |

**After all phases:** Main bundle drops from 574 KB → ~110 KB. Three.js chunk eliminated entirely. First meaningful paint 400-600ms faster.

---

## Dependency Graph

```
Phase 1 (remove dead weight):
  Step 1 (dynamic GhostPanel) ──→ Step 2 (remove deps from package.json)

Phase 2 (code-split):
  Step 3 (lazy RadicalGame) ── independent

Phase 3 (faster startup):
  Step 4 (parallel cartridge load) ── independent
  Step 5 (batch DOM) ── independent
  Step 6 (server timeout) ── independent

Phase 4 (Vite config):
  Step 7 (manual chunks) ── depends on Step 1 (dynamic import must exist first)

Phase 5 (preload):
  Step 8 (preload registry) ── independent
```

**Parallelization:**
- Wave 1: Steps 1, 3, 4, 5, 6, 8 (all independent)
- Wave 2: Steps 2, 7 (depend on Step 1)
