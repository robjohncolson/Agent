# Step 3: Disable Game Controller & Launchers in app.html

## File to modify
`platform/app.html`

## Problem
The GhostOrbitsController import pulls in arena-mode.js, trails-mode.js, blizzard-mode.js, and ghost-orbits-renderer.js — all of which create canvas/WebGL contexts. Even if never launched, the import tree may trigger side effects.

## Changes Required

### 1. Comment out the GhostOrbitsController import (line ~1024)

Change:
```javascript
import { GhostOrbitsController, GameState as OrbitsGameState } from './game/ghost-orbits-controller.js';
```
To:
```javascript
// DISABLED: Game modes cause WebGL context conflicts
// import { GhostOrbitsController, GameState as OrbitsGameState } from './game/ghost-orbits-controller.js';
const OrbitsGameState = { IDLE: 'idle', CONNECTING: 'connecting', COUNTDOWN: 'countdown', PLAYING: 'playing', ELIMINATED: 'eliminated', SPECTATING: 'spectating', ROUND_END: 'round_end', INTERMISSION: 'intermission' };
```

(We keep OrbitsGameState as a plain object so any references to it don't throw)

### 2. Make `initGhostOrbits()` a no-op (line ~1536)

Replace the function body:
```javascript
function initGhostOrbits(modeType = 'arena') {
  console.log('[GhostOrbits] Game modes disabled to prevent WebGL context conflicts');
  return null;
}
```

### 3. Make `canEnterGhostOrbits()` return false (line ~1570)

Replace:
```javascript
function canEnterGhostOrbits() {
  return false; // Game modes disabled
}
```

### 4. Make `launchGhostOrbits()` a no-op (line ~1581)

Replace:
```javascript
async function launchGhostOrbits() {
  console.log('[GhostOrbits] Game modes disabled to prevent WebGL context conflicts');
  return false;
}
```

### 5. Keep the global exports (line ~1647)
These lines should stay as-is since ghost-panel.js calls them:
```javascript
window.launchGhostOrbits = launchGhostOrbits;
window.canEnterGhostOrbits = canEnterGhostOrbits;
```

### 6. Keep `notifyGhostOrbitsGoldStar()` safe (line ~1632)
It already has a null guard (`if (ghostOrbitsController && ...)`), so it's safe with `ghostOrbitsController = null`.

## Verification
- App loads without importing game mode modules (check Network tab — no arena-mode.js, trails-mode.js, blizzard-mode.js)
- `canEnterGhostOrbits()` returns false in console
- No WebGL contexts created by game controllers
- All other app functionality works (problems, ghost training, stars)
