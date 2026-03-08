# Agent: Test Deep-Link Round-Trip

## Phase
P3-education-hardening | No dependencies | Working dir: `C:/Users/ColsonR/lrsl-driller`

## Objective
Write Vitest tests for deep-link navigation, page refresh state restoration, and progression gating after deep-link entry.

## Context: The Two Deep-Link Code Paths

```
PATH A: Direct Navigation (user pastes URL)
  URL: ?cartridge=apstats-u5&mode=3
    ↓
  window.onload / DOMContentLoaded
    ↓
  parseQueryParams() → { cartridge: "apstats-u5", mode: 3 }
    ↓
  loadCartridge("apstats-u5")
    ├── Fetch cartridges/registry.json
    ├── Fetch cartridges/apstats-u5/manifest.json
    ├── Fetch cartridges/apstats-u5/generator.js
    ├── Fetch cartridges/apstats-u5/grading-rules.js
    └── setActiveMode(3) → generateProblem(3)

PATH B: URL Restoration After Refresh
  User is on mode 5, completed modes 1-4
    ↓
  Page refresh (F5 / browser reload)
    ↓
  URL still has: ?cartridge=apstats-u5&mode=5
    ↓
  window.onload
    ↓
  parseQueryParams() → { cartridge: "apstats-u5", mode: 5 }
    ↓
  loadCartridge("apstats-u5")
    ↓
  restoreState() ← THIS PATH WAS MISSED IN THE ORIGINAL FIX
    ├── Read localStorage for progress data
    ├── Verify modes 1-4 are completed
    └── setActiveMode(5)
    ↓
  history.replaceState() ← Updates URL without navigation
```

**The bug:** Original fix only covered Path A. Path B (URL restoration after refresh) used a different code path that didn't respect the deep-link mode parameter, sending students back to an earlier level.

## Read First
1. `platform/app.html` — search for `parseQueryParams`, `loadCartridge`, `restoreState`, `history.replaceState`
2. `platform/core/game-engine.js` — `loadState()`, `checkUnlocks()`, mode progression
3. `cartridges/apstats-u5-sampling-dist/manifest.json` — example manifest with `unlockedBy` chains
4. Existing tests in `tests/` — avoid duplication

## Owned Paths
- `tests/deep-link-roundtrip.test.js`

## Test Structure

```javascript
// tests/deep-link-roundtrip.test.js
import { describe, test, expect, beforeEach, vi } from 'vitest';

describe('Deep-link: Path A — Direct Navigation', () => {
  test('loads correct cartridge from URL params', () => {
    // Set window.location.search = '?cartridge=apstats-u5&mode=3'
    // Call init sequence
    // Assert: active cartridge is apstats-u5, active mode is 3
  });

  test('loads mode 1 when no mode param specified', () => {
    // URL: ?cartridge=apstats-u5 (no mode)
    // Assert: defaults to mode 1 (first unlocked)
  });

  test('redirects to first locked prerequisite if mode is locked', () => {
    // URL: ?cartridge=apstats-u5&mode=5
    // localStorage: modes 1-2 completed, 3-4 not completed
    // Manifest: mode 5 unlockedBy mode 4
    // Assert: redirects to mode 3 (first incomplete prerequisite)
  });
});

describe('Deep-link: Path B — URL Restoration After Refresh', () => {
  test('preserves mode after page refresh', () => {
    // Setup: user was on mode 5, modes 1-4 completed in localStorage
    // Simulate: page refresh (clear runtime state, keep URL + localStorage)
    // Call init sequence
    // Assert: active mode is 5, NOT mode 1
  });

  test('preserves progress state after refresh', () => {
    // Setup: mode 3 in progress, 2 questions answered
    // Refresh
    // Assert: mode 3 active, previous answers preserved
  });

  test('URL restoration respects progression gating', () => {
    // Setup: URL says mode 5, but localStorage shows only modes 1-2 done
    // (User manually edited URL)
    // Assert: redirects to first locked prerequisite, not mode 5
  });
});

describe('Deep-link: Progression After Deep-Link Entry', () => {
  test('completing deep-linked mode advances to next', () => {
    // Enter via deep-link to mode 5
    // Complete mode 5
    // Assert: advances to mode 6, NOT back to mode 1
  });

  test('completing last mode shows completion state', () => {
    // Deep-link to last mode
    // Complete it
    // Assert: shows cartridge completion, not loop back
  });

  test('the 5-7 to 5-2 regression does not occur', () => {
    // Bug repro: user completes level 5-7
    // Assert: next level is 5-8 or completion, NOT 5-2
  });
});
```

## Verification
```bash
npx vitest run tests/deep-link-roundtrip.test.js --reporter=verbose
```
