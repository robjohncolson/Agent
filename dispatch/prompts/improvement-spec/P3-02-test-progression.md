# Agent: Test Progression Regression

## Phase
P3-education-hardening | No dependencies | Working dir: `C:/Users/ColsonR/lrsl-driller`

## Objective
Write Vitest tests for level completion → next level advancement, specifically preventing the 5-7→5-2 regression.

## Context: Progression Dependency Chain

```
User completes a problem correctly
  ↓
gameEngine.recordResult(fieldId, score, allFieldsCorrect=true)
  ↓
calculatePenalties(hintsUsed, retries)
  ↓
getStarType(penalties) → gold/silver/bronze/tin
  ↓
awardStar(starType, currentTier)
  ├── Increment starCounts[starType]
  ├── Increment starsPerMode[modeId][starType]
  └── onStarEarned callback
  ↓
checkUnlocks(manifest.modes)
  ├── For each locked mode:
  │   ├── Check unlockedBy field
  │   ├── If prerequisite mode has enough gold stars → UNLOCK
  │   └── Else → remain locked
  └── Return newly unlocked modes
  ↓
advanceToNextMode()  ← BUG LIVED HERE
  ├── Find current mode index in modeOrder
  ├── Next = modeOrder[currentIndex + 1]
  └── If next is unlocked → setActiveMode(next)
      If next is locked → ???  ← edge case
```

**The bug:** `advanceToNextMode()` used an incorrect index calculation that wrapped around to an earlier mode under certain conditions.

## Read First
1. `platform/core/game-engine.js` — `recordResult()`, `awardStar()`, `checkUnlocks()`, `advanceToNextMode()`
2. `cartridges/apstats-u5-sampling-dist/manifest.json` — `modes[]` with `unlockedBy` fields
3. `cartridges/registry.json` — all cartridge IDs

## Owned Paths
- `tests/progression-regression.test.js`

## Test Structure

```javascript
describe('Progression: Star Award → Unlock → Advance', () => {
  test('completing mode N advances to mode N+1', () => {
    // For modes 1 through 7: complete each, verify next is N+1
  });

  test('completing last mode does not wrap to beginning', () => {
    // Complete final mode → should show completion, not mode 1
  });

  test('5-7 completion advances to 5-8 not 5-2', () => {
    // Specific regression test for the reported bug
  });

  test('unlock chain: mode 3 unlocks after mode 2 gold', () => {
    // mode 3 has unlockedBy: "mode-2"
    // Award gold on mode 2
    // Assert: mode 3 now unlocked
  });

  test('advance skips locked modes to next unlocked', () => {
    // mode 4 locked, mode 5 unlocked
    // Complete mode 3
    // Assert: advances to mode 5, not stuck on locked mode 4
  });
});

describe('Progression: Edge Cases', () => {
  test('tin star still counts for completion but not unlock', () => {
    // Tin = 3+ penalties, still completes the problem
    // But may not accumulate enough gold to unlock next tier
  });

  test('concurrent mode completions do not corrupt index', () => {
    // Rapid submissions don't cause race condition in modeOrder index
  });

  test('cartridge switch preserves per-cartridge progress', () => {
    // Switch from cartridge A to B and back
    // Assert: A's progress unchanged
  });
});
```

## Verification
```bash
npx vitest run tests/progression-regression.test.js --reporter=verbose
```
