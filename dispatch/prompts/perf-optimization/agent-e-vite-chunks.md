# Agent E: Vite manualChunks Config

## File to modify
`vite.config.js`

## Change

Find the `build` config block (line ~234):
```javascript
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        app: 'platform/app.html',
        mathViz: 'standalone/math-viz/index.html'
      }
    }
  },
```

Add an `output` block with `manualChunks` inside `rollupOptions`:
```javascript
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        app: 'platform/app.html',
        mathViz: 'standalone/math-viz/index.html'
      },
      output: {
        manualChunks(id) {
          if (id.includes('graph-engine')) {
            return 'graph';
          }
        }
      }
    }
  },
```

That's it. The function checks each module ID during bundling and assigns matching
modules to named chunks. Vite automatically generates `<link rel="modulepreload">`
for these chunks so the browser downloads them in parallel.

## Why only graph-engine?
- Radical games are already code-split via dynamic import (previous commit)
- Ghost/game modules are tree-shaken (imports commented out)
- WebRTC/P2P/Roster will be dynamically imported by Agent F (separate file)
- graph-engine is the only large module (77KB source) that must stay static

## Verification
- `npm run build` succeeds
- Output shows a separate `graph-*.js` chunk (~35KB)
- Main `app-*.js` bundle is smaller than before
