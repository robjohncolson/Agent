# Agent A — Build Script: Add Square Mode BAKED_REGISTRY Injection

## Task
Modify `scripts/build-roadmap-data.mjs` to also inject `BAKED_REGISTRY` into the square mode HTML file.

## Owned File
`scripts/build-roadmap-data.mjs`

## What to Do

1. **Add a new constant** after line 21 (`const ROADMAP_HTML = ...`):
```js
const SQUARE_HTML  = join(WORKSHEET_REPO, "ap_stats_roadmap_square_mode.html");
```

2. **Duplicate the injection block** (lines 111–126) for the square mode file. After the existing try/catch block, add a second try/catch that does the exact same injection but reads/writes `SQUARE_HTML` instead of `ROADMAP_HTML`, and logs `"Injected BAKED_REGISTRY into ap_stats_roadmap_square_mode.html"`.

The regex pattern is the same: `/^(\s*)const BAKED_REGISTRY\s*=\s*\{[^;]*\};/m`

The replacement is the same: `` `${indent}const BAKED_REGISTRY = ${outputJson};` ``

## Output Contract
After this change, running `node scripts/build-roadmap-data.mjs` should print both:
- `Injected BAKED_REGISTRY into ap_stats_roadmap.html`
- `Injected BAKED_REGISTRY into ap_stats_roadmap_square_mode.html`

(The second line will only appear once Agent B adds the placeholder to the square mode HTML.)

## Do NOT
- Modify any other file
- Change the existing injection logic for `ROADMAP_HTML`
- Change the roadmap-data.json output format
