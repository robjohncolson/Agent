# Step 2: Disable Three.js Renderers + Game Mode UI in Ghost Panel

## File to modify
`platform/game/ghost-panel.js`

## Problem
Three.js MazeRenderer and TerrainRenderer create WebGL contexts that conflict with TensorFlow.js. The game mode launcher UI (Arena/Trails/Blizzard buttons) triggers canvas-heavy game controllers.

## Changes Required

### 1. Disable MazeRenderer initialization

Find the method that initializes the maze renderer (likely called `initMazeRenderer`, `initMaze`, or similar — search for `new MazeRenderer` or `this.mazeRenderer`).

Wrap the renderer creation in a disabled guard:
```javascript
// DISABLED: Three.js WebGL maze renderer causes context conflicts
// this.mazeRenderer = new MazeRenderer(...);
this.mazeRenderer = null;
this.mazeError = 'Game modes disabled — 3D visualization unavailable';
console.log('[GhostPanel] Maze renderer disabled to prevent WebGL conflicts');
```

### 2. Disable TerrainRenderer initialization

Find where `new TerrainRenderer` is called (likely in a `initTerrain` or `renderClassView` method).

Same pattern:
```javascript
// DISABLED: Three.js WebGL terrain renderer causes context conflicts
// this.terrainRenderer = new TerrainRenderer(...);
this.terrainRenderer = null;
this.terrainError = 'Game modes disabled — terrain visualization unavailable';
console.log('[GhostPanel] Terrain renderer disabled to prevent WebGL conflicts');
```

### 3. Hide the game mode launcher UI

Find the HTML template that creates the orbits section. Look for the string `ghost-orbits-mode-selector` or `ghost-orbits-enter-btn` in the template literal.

There's a section around line 350-370 that creates:
```html
<div class="ghost-orbits-mode-selector">
  <label for="ghost-orbits-mode-select">Game Mode:</label>
  <select id="ghost-orbits-mode-select">...</select>
  <button class="ghost-orbits-btn locked" id="ghost-orbits-enter-btn" disabled>...</button>
  <button class="ghost-orbits-btn multiplayer" id="ghost-orbits-multiplayer-btn">...</button>
</div>
```

Replace the entire orbits section with a disabled notice:
```html
<div class="ghost-orbits-mode-selector" style="opacity: 0.5; pointer-events: none;">
  <p style="text-align: center; color: #888; font-size: 12px; padding: 8px;">
    ⚠ Game modes temporarily disabled
  </p>
</div>
```

### 4. Make `getSelectedMode()` safe

Find the `getSelectedMode()` method and ensure it returns a safe default even with the selector hidden:
```javascript
getSelectedMode() {
  return 'arena'; // Game modes disabled
}
```

## Verification
- Ghost panel opens without creating any WebGL contexts
- No Three.js renderer errors in console
- Game mode buttons are replaced with "disabled" notice
- My Ghost tab still works (fractal canvas is 2D, not WebGL)
