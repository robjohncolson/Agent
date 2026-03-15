# Agent B: Lazy-Load RadicalGame Variants in InputRenderer

## File to modify
`platform/core/input-renderer.js`

## Problem
Three RadicalGame modules (~64 KB total) are imported at module scope but only used when a problem has `type: 'visual-radical'`, `'visual-radical-prime'`, or `'visual-radical-complex'`. Most cartridges (AP Stats, sampling, experimental design) never use them.

## Changes

### 1. Remove the static imports (lines 7-9)

**Find:**
```javascript
import { RadicalGame } from './radical-game.js';
import { RadicalPrimeGame } from './radical-prime-game.js';
import { RadicalComplexGame } from './radical-complex-game.js';
```

**Replace with:**
```javascript
// Lazy-loaded on demand — only when visual-radical problem types are encountered
let RadicalGame = null;
let RadicalPrimeGame = null;
let RadicalComplexGame = null;
```

### 2. Add lazy loader in `renderVisualRadical()` (line ~318)

The method creates the game inside a `setTimeout(() => { ... }, 0)`. The dynamic import fits naturally inside that async boundary.

**Find the `renderVisualRadical` method. Inside the `setTimeout` callback, before `new RadicalGame(...)`, add:**
```javascript
setTimeout(async () => {
  if (!RadicalGame) {
    ({ RadicalGame } = await import('./radical-game.js'));
  }
  const game = new RadicalGame(wrapper, {
```

Note: change `setTimeout(() => {` to `setTimeout(async () => {` to support await.

### 3. Same pattern for `renderVisualRadicalPrime()` (line ~350)

**Inside the setTimeout callback, before `new RadicalPrimeGame(...)`, add:**
```javascript
setTimeout(async () => {
  if (!RadicalPrimeGame) {
    ({ RadicalPrimeGame } = await import('./radical-prime-game.js'));
  }
  const game = new RadicalPrimeGame(wrapper, {
```

### 4. Same pattern for `renderVisualRadicalComplex()` (line ~381)

**Inside the setTimeout callback, before `new RadicalComplexGame(...)`, add:**
```javascript
setTimeout(async () => {
  if (!RadicalComplexGame) {
    ({ RadicalComplexGame } = await import('./radical-complex-game.js'));
  }
  const game = new RadicalComplexGame(wrapper, {
```

## Key Detail
The `{ RadicalGame }` destructuring syntax is required because each module exports the class as a named export. The pattern `({ RadicalGame } = await import('./radical-game.js'))` assigns the named export to the outer `let` variable, so subsequent calls skip the import.

## Verification
- Build must succeed: `npm run build`
- Load an AP Stats cartridge — no radical modules should appear in Network tab
- Load the algebra2-radicals cartridge — radical modules load on first problem
- Visual radical interaction still works (drag squares, answer submission)
