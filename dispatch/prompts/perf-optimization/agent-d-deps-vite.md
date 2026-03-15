# Agent D: Remove Dead Dependencies + Vite Chunk Config

## Files to modify
1. `package.json`
2. `vite.config.js`

## Prerequisites
Agent A must have completed (GhostPanel import is now dynamic/disabled).

## Changes

### 1. Remove unused dependencies from package.json

**Find the `"dependencies"` block:**
```json
"dependencies": {
  "@tensorflow/tfjs": "^4.17.0",
  "three": "^0.159.0"
}
```

**Replace with an empty block:**
```json
"dependencies": {}
```

Both libraries are completely unused:
- TensorFlow.js: ghost-engine.js is a no-op stub, ghost-network.js uses lazy `let tf = null`
- Three.js: ghost-panel.js import is now dynamic/disabled, maze/terrain renderers are disabled

### 2. Add manual chunk splitting to vite.config.js

**Find the `build` config (line ~236):**
```javascript
build: {
  rollupOptions: {
    input: {
      main: 'index.html',
      app: 'platform/app.html',
      mathViz: 'standalone/math-viz/index.html'
    }
  }
}
```

**Replace with:**
```javascript
build: {
  rollupOptions: {
    input: {
      main: 'index.html',
      app: 'platform/app.html',
      mathViz: 'standalone/math-viz/index.html'
    },
    output: {
      manualChunks(id) {
        // Split graph engine into its own chunk (loaded with first graph problem)
        if (id.includes('graph-engine')) {
          return 'graph';
        }
        // Split radical game modules (loaded only for radical cartridges)
        if (id.includes('radical-game') || id.includes('radical-prime-game') || id.includes('radical-complex-game')) {
          return 'radicals';
        }
      }
    }
  }
}
```

### 3. Run npm install to update lockfile

After editing package.json, run:
```bash
npm install
```

This will remove three and @tensorflow/tfjs from node_modules and update package-lock.json.

## Verification
- `npm install` succeeds without errors
- `npm run build` succeeds
- `dist/assets/` should NOT contain any `three.module-*.js` chunk
- Main `app-*.js` bundle should be significantly smaller (target: <150 KB)
- App loads and works correctly in browser
