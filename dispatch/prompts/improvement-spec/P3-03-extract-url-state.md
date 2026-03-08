# Agent: Extract URL State Module

## Phase
P3-education-hardening | Depends on: test-deep-link-roundtrip | Working dir: `C:/Users/ColsonR/lrsl-driller`

## Objective
Extract URL state management from app.html (3600 lines) into a dedicated `platform/core/url-state.js` module with its own test file.

## Dependencies
- **test-deep-link-roundtrip** must be green first — the extracted module must pass existing tests

## Context: What to Extract

Currently scattered across app.html:
1. `parseQueryParams()` — reads URL search params
2. `updateURL(cartridgeId, modeId)` — calls `history.replaceState()`
3. `restoreStateFromURL()` — on page load, determines initial cartridge + mode
4. Deep-link validation logic — checks if requested mode is unlocked
5. URL parameter encoding/decoding for sharing

## Dependency Awareness

```
url-state.js (NEW — extracted module)
  ├── READS FROM: window.location (URL), localStorage (progress)
  ├── WRITES TO: window.history (replaceState), URL params
  ├── CONSUMED BY: app.html init sequence, loadCartridge(), advanceToNextMode()
  └── DEPENDS ON: game-engine.js (checkUnlocks for validation)
```

**Critical constraint:** The init sequence in app.html calls these functions in a specific order:
```
1. parseQueryParams()        ← url-state.js
2. loadCartridge(id)         ← app.html (uses url-state output)
3. restoreStateFromURL()     ← url-state.js
4. setActiveMode(mode)       ← game-engine.js (uses url-state output)
```
Do NOT change this order. The module must be a drop-in extraction.

## Owned Paths
- `platform/core/url-state.js`
- `tests/core/url-state.test.js`

## Implementation Sketch

```javascript
// platform/core/url-state.js

export function parseQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    cartridge: params.get('cartridge'),
    mode: params.get('mode') ? parseInt(params.get('mode')) : null,
    // ... other params
  };
}

export function updateURL(cartridgeId, modeId) {
  const url = new URL(window.location);
  url.searchParams.set('cartridge', cartridgeId);
  if (modeId != null) url.searchParams.set('mode', modeId);
  history.replaceState({}, '', url);
}

export function resolveInitialMode(requestedMode, unlockedModes, completedModes) {
  // If requested mode is unlocked → use it
  // If locked → find first incomplete prerequisite
  // If no mode requested → first unlocked incomplete mode
}

export function buildShareURL(cartridgeId, modeId) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('cartridge', cartridgeId);
  url.searchParams.set('mode', modeId);
  return url.toString();
}
```

## Constraints
- Pure extraction — do NOT add new features
- Must pass all existing tests + new deep-link-roundtrip tests
- app.html must import from this module (update script tag)
- Do not break the init sequence order

## Verification
```bash
npx vitest run tests/core/url-state.test.js tests/deep-link-roundtrip.test.js --reporter=verbose
npm test  # Full suite must still pass
```
