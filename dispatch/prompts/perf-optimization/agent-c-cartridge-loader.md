# Agent C: Parallelize CartridgeLoader Network Requests

## File to modify
`platform/core/cartridge-loader.js`

## Problem
The `load()` method makes 4-5 sequential network requests:
```
await loadJSON(manifest.json)     → wait
await loadJSON(contexts.json)     → then wait
await loadModule(generator.js)    → then wait
await loadModule(grading-rules.js) → then wait
await loadText(ai-prompt.txt)     → then wait
```
Each takes ~50-100ms. Total: 200-500ms serialized when they could overlap.

## Change

The manifest must load first (it tells us what other files to fetch). After that, contexts, generator, grading rules, and AI prompt can all load in parallel.

**Find the `load()` method (starts around line 63). After the manifest is loaded and its progress callback fires, replace the sequential loads with a parallel block.**

**Current pattern (sequential):**
```javascript
// Load manifest
const manifest = await this.loadJSON(`${cartridgePath}/manifest.json`);

// Load contexts
if (manifest.config?.contextsFile) {
  this.contexts = await this.loadJSON(`${cartridgePath}/${manifest.config.contextsFile}`);
} else if (manifest.config?.sharedContexts) {
  this.contexts = await this.loadJSON(`${this.sharedPath}/contexts/${manifest.config.sharedContexts}.json`);
}

// Load generator
const generator = await this.loadModule(generatorPath);

// Load grading rules
if (manifest.grading?.rubricFile) { gradingRules = await ... }

// Load AI prompt
if (manifest.grading?.aiPromptFile) { aiPrompt = await ... }
```

**New pattern (parallel after manifest):**
```javascript
// Load manifest first (needed to know what else to fetch)
progress('manifest', 'manifest.json', 'loading');
const manifest = await this.loadJSON(`${cartridgePath}/manifest.json`);
progress('manifest', 'manifest.json', 'done');

// Prepare parallel fetch promises
const contextPromise = (() => {
  if (manifest.config?.contextsFile) {
    const contextFile = manifest.config.contextsFile;
    progress('contexts', contextFile, 'loading');
    return this.loadJSON(`${cartridgePath}/${contextFile}`).then(r => {
      progress('contexts', contextFile, 'done');
      return r;
    });
  } else if (manifest.config?.sharedContexts) {
    const contextFile = `${manifest.config.sharedContexts}.json`;
    progress('contexts', contextFile, 'loading');
    return this.loadJSON(`${this.sharedPath}/contexts/${contextFile}`).then(r => {
      progress('contexts', contextFile, 'done');
      return r;
    });
  }
  progress('contexts', 'none', 'skipped');
  return Promise.resolve(null);
})();

const generatorPath = `${cartridgePath}/generator.js`;
progress('generator', 'generator.js', 'loading');
const generatorPromise = this.loadModule(generatorPath).then(r => {
  console.log(`[CartridgeLoader] Generator loaded:`, r ? 'success' : 'null', 'Has generateProblem:', !!r?.generateProblem);
  progress('generator', 'generator.js', 'done');
  return r;
});

const gradingPromise = (() => {
  if (manifest.grading?.rubricFile) {
    progress('grading', manifest.grading.rubricFile, 'loading');
    const loadFn = manifest.grading.rubricFile.endsWith('.js')
      ? this.loadModule(`${cartridgePath}/${manifest.grading.rubricFile}`)
      : this.loadJSON(`${cartridgePath}/${manifest.grading.rubricFile}`);
    return loadFn.then(r => {
      progress('grading', manifest.grading.rubricFile, 'done');
      return r;
    });
  }
  progress('grading', 'none', 'skipped');
  return Promise.resolve(null);
})();

const aiPromptPromise = (() => {
  if (manifest.grading?.aiPromptFile) {
    progress('ai', manifest.grading.aiPromptFile, 'loading');
    return this.loadText(`${cartridgePath}/${manifest.grading.aiPromptFile}`).then(r => {
      progress('ai', manifest.grading.aiPromptFile, 'done');
      return r;
    });
  }
  progress('ai', 'none', 'skipped');
  return Promise.resolve(null);
})();

// Execute all in parallel
const [contexts, generator, gradingRules, aiPrompt] = await Promise.all([
  contextPromise,
  generatorPromise,
  gradingPromise,
  aiPromptPromise
]);

this.contexts = contexts;
```

**Then update the `this.loadedCartridge = { ... }` block below to use the local variables `contexts`, `generator`, `gradingRules`, `aiPrompt` from the destructured Promise.all result.**

## Important
- Keep all the `progress()` callbacks — they drive the loading UI
- Keep the `console.log` for generator load success
- The `this.contexts = contexts` assignment must still happen (other code reads it)
- Error handling: the existing try/catch around the whole method still works

## Verification
- Build must succeed: `npm run build`
- Load a cartridge — Network tab should show contexts + generator + grading loading simultaneously (not sequentially)
- Cartridge should render correctly with all problems, grading, and AI prompts working
