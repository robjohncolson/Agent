# Agent F: Dynamic Imports for WebRTC, P2P, SyncQueue, RosterModal

## File to modify
`platform/app.html`

## Problem
Four modules (~46KB combined) are statically imported but only used conditionally:
- WebRTCManager (14KB) — multiplayer only
- P2PAssetTransfer (14KB) — multiplayer only
- SyncQueue (12KB) — multiplayer only
- RosterModal (20KB) — teacher only

## Changes

### 1. Remove static imports (lines ~1022, 1030-1031)

**Find and comment out these lines:**
```javascript
import { RosterModal } from './core/roster-modal.js';
```
and:
```javascript
import { SyncQueue } from './core/sync-queue.js';
import { WebRTCManager } from './core/webrtc-manager.js';
```

**Replace with lazy declarations:**
```javascript
// Lazy-loaded: only used by teachers
// import { RosterModal } from './core/roster-modal.js';
let RosterModal = null;

// Lazy-loaded: only used for multiplayer
// import { SyncQueue } from './core/sync-queue.js';
// import { WebRTCManager } from './core/webrtc-manager.js';
let SyncQueue = null;
let WebRTCManager = null;
```

Also comment out:
```javascript
import { P2PAssetTransfer } from './core/p2p-asset-transfer.js';
```
And add:
```javascript
// Lazy-loaded: only used for multiplayer P2P
// import { P2PAssetTransfer } from './core/p2p-asset-transfer.js';
let P2PAssetTransfer = null;
```

### 2. Lazy-load RosterModal where it's first used

**Find the code around line ~3035 that creates the roster modal:**
```javascript
if (!rosterModal) {
  rosterModal = new RosterModal({ serverUrl: SERVER_URL });
}
```

**Replace with:**
```javascript
if (!rosterModal) {
  if (!RosterModal) {
    ({ RosterModal } = await import('./core/roster-modal.js'));
  }
  rosterModal = new RosterModal({ serverUrl: SERVER_URL });
}
```

Make sure the enclosing function is `async`. Look at the function that contains this code — it's likely already async or inside an async handler.

### 3. Lazy-load WebRTCManager where it's first used

**Find the function `initWebRTCManager` (search for it). Inside, before `new WebRTCManager`, add the dynamic import:**
```javascript
if (!WebRTCManager) {
  ({ WebRTCManager } = await import('./core/webrtc-manager.js'));
}
```

Make sure the function is async.

### 4. Lazy-load P2PAssetTransfer where it's first used

**Find where P2PAssetTransfer is instantiated (line ~1244-1245):**
```javascript
if (connected && wsClient.currentUsername && !p2pAssetTransfer) {
  p2pAssetTransfer = new P2PAssetTransfer(wsClient, assetCache, wsClient.currentUsername);
```

**Replace with:**
```javascript
if (connected && wsClient.currentUsername && !p2pAssetTransfer) {
  if (!P2PAssetTransfer) {
    ({ P2PAssetTransfer } = await import('./core/p2p-asset-transfer.js'));
  }
  p2pAssetTransfer = new P2PAssetTransfer(wsClient, assetCache, wsClient.currentUsername);
```

Make sure the enclosing function/callback is async.

### 5. Lazy-load SyncQueue where it's first used

**Find where SyncQueue is instantiated. Search for `new SyncQueue`. Before that line:**
```javascript
if (!SyncQueue) {
  ({ SyncQueue } = await import('./core/sync-queue.js'));
}
```

## Important Notes
- The `({ ClassName } = await import(...))` pattern destructures the named export and assigns to the outer `let` variable. Subsequent calls skip the import.
- Each enclosing function must be `async` for `await` to work. Most handlers in this app are already async.
- AssetCache and AssetResolver are NOT changed — they're used at startup.

## Verification
- `npm run build` succeeds
- App loads for a student — no WebRTC/P2P/Roster/SyncQueue in Network tab
- Teacher mode still works (roster modal loads on demand)
- Multiplayer still works (WebRTC loads when WS connects)
