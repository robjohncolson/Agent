# Disable Game Modes — Dependency Graph

## Steps

```
Step 1: Force TF.js CPU Backend
  File: platform/core/ghost-engine.js
  Depends on: (none)

Step 2: Disable Three.js Renderers + Game Mode UI
  File: platform/game/ghost-panel.js
  Depends on: (none)

Step 3: Disable Game Controller + Launchers
  File: platform/app.html
  Depends on: (none)
```

## Parallelization

```
Wave 1 (all parallel — each step touches a different file):
  ┌─────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐
  │ Step 1               │  │ Step 2                    │  │ Step 3                    │
  │ ghost-engine.js      │  │ ghost-panel.js            │  │ app.html                  │
  │ CPU backend          │  │ Disable 3D + game UI      │  │ No-op launchers           │
  └─────────────────────┘  └──────────────────────────┘  └──────────────────────────┘
```

All 3 steps are independent — they modify different files with no cross-dependencies.
Single wave, full parallel execution.

## Verification (post-merge)

After all steps complete:
1. `npm run build` in lrsl-driller/ — must succeed with no import errors
2. Open app in browser, complete 4+ interactions
3. Console should show `[Ghost] Trained on interaction #4` with NO WebGL errors
4. Ghost panel opens, shows proficiency — no freeze
5. Game mode buttons are hidden/disabled
