# Agent A: app.html Performance Optimizations

## File to modify
`platform/app.html`

## Changes (4 optimizations in one file)

### 1. Dynamic-import GhostPanel (biggest win: ~500 KB)

The static import at the top pulls in Three.js (466 KB), maze/terrain renderers, battle viz, orbits lobby, and multiplayer client — all unused.

**Find line ~1023:**
```javascript
import { GhostPanel, createGhostButton } from './game/ghost-panel.js';
```

**Replace with:**
```javascript
// LAZY: GhostPanel imports Three.js (466KB) — only load if ghost button ever clicked
// import { GhostPanel, createGhostButton } from './game/ghost-panel.js';
let GhostPanel = null;
```

**Then find `initGhostPanel()` function (line ~1425) and replace its body:**
```javascript
function initGhostPanel() {
  // Ghost system disabled — no-op
  return;
}
```

**Then find `toggleGhostPanel()` function (line ~1470) and replace its body:**
```javascript
async function toggleGhostPanel() {
  // Ghost system disabled — no-op
  return;
}
```

**Then find `updateGhostPanelForCartridge()` function (line ~1498) and replace its body:**
```javascript
function updateGhostPanelForCartridge() {
  // Ghost system disabled — no-op
  return;
}
```

### 2. Batch DOM creation in populateCartridgeList (line ~3567)

**Find the function `populateCartridgeList()`. Inside, find the loop that creates buttons:**
```javascript
for (const [subject, cartridges] of Object.entries(grouped)) {
  // ...
  listEl.appendChild(header);
  for (const cart of cartridges) {
    // ...
    listEl.appendChild(btn);
    // ...
    selectEl.appendChild(option);
  }
}
```

**Replace with DocumentFragment batching. Wrap the entire loop body:**
```javascript
const listFragment = document.createDocumentFragment();
const selectFragment = document.createDocumentFragment();

for (const [subject, cartridges] of Object.entries(grouped)) {
  const colors = subjectColors[subject] || subjectColors.default;

  const header = document.createElement('div');
  header.className = `text-xs font-bold ${colors.header} uppercase tracking-wide px-2 pt-1`;
  header.textContent = subject;
  listFragment.appendChild(header);

  for (const cart of cartridges) {
    const btn = document.createElement('button');
    btn.className = `cartridge-option w-full flex items-center gap-3 p-2 rounded-lg ${colors.btnHover} transition-colors border-2 border-transparent`;
    btn.dataset.cartridge = cart.id;
    btn.innerHTML = `
      <div class="w-10 h-14 bg-gradient-to-b ${colors.cartridge} rounded flex items-center justify-center text-white text-xs font-bold shadow">
        ${cart.shortCode || cart.id.substring(0, 4).toUpperCase()}
      </div>
      <div class="text-left flex-1">
        <div class="font-semibold text-gray-800 text-sm">${cart.name}</div>
        <div class="text-xs text-gray-500">${cart.description || ''}</div>
      </div>
    `;
    listFragment.appendChild(btn);

    const option = document.createElement('option');
    option.value = cart.id;
    option.textContent = cart.name;
    selectFragment.appendChild(option);
  }
}

listEl.appendChild(listFragment);
selectEl.appendChild(selectFragment);
```

### 3. Reduce server detection timeout (line ~1046)

**Find:**
```javascript
const timeout = setTimeout(() => controller.abort(), 2000);
```

**Replace with:**
```javascript
const timeout = setTimeout(() => controller.abort(), 1000);
```

### 4. Preload registry.json

**Find the `<head>` section (line ~3), add after the `<meta>` tags:**
```html
<link rel="preload" href="/cartridges/registry.json" as="fetch" crossorigin>
```

## Verification
- Build must succeed: `npm run build`
- App should load without ghost panel, Three.js, or game mode code
- Cartridge list should render in a single DOM operation
- Server detection should timeout after 1s instead of 2s
