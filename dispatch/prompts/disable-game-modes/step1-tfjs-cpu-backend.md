# Step 1: Force TensorFlow.js CPU Backend

## File to modify
`platform/core/ghost-engine.js`

## Problem
TensorFlow.js defaults to WebGL backend for GPU acceleration. This creates a WebGL context that conflicts with Three.js and canvas renderers, causing "object does not belong to this context" errors and app freezes.

## Changes Required

### 1. In `ensureTensorFlowLoaded()` function (around line 317-360)

After the line:
```javascript
GhostNetwork.initTensorFlow(window.tf);
tfLoaded = true;
```

Add immediately after `tfLoaded = true;`:
```javascript
// Force CPU backend to avoid WebGL context conflicts
// Ghost network is only 516 params — CPU is more than adequate
try {
  await window.tf.setBackend('cpu');
  await window.tf.ready();
  console.log('[Ghost] TensorFlow.js backend set to CPU (WebGL disabled)');
} catch (backendErr) {
  console.warn('[Ghost] Could not set CPU backend:', backendErr.message);
}
```

### 2. In `init()` function (around line 36-45)

After the line where `tfInstance` is checked and `tfLoaded` is set to true:
```javascript
if (tfInstance) {
    GhostNetwork.initTensorFlow(tfInstance);
    tfLoaded = true;
```

Add after `tfLoaded = true;`:
```javascript
    // Force CPU backend to avoid WebGL context conflicts
    if (tfInstance.setBackend) {
      tfInstance.setBackend('cpu');
      console.log('[Ghost] TensorFlow.js backend forced to CPU');
    }
```

## Verification
- The console should log `[Ghost] TensorFlow.js backend set to CPU (WebGL disabled)` when TF loads
- No `gpgpu_util.js` WebGL errors should appear
- Ghost training still works (proficiency updates after interactions)
