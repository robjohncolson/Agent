# Task: Create lesson URL assembly script

## Create file
`C:/Users/ColsonR/Agent/scripts/lesson-urls.mjs`

## Purpose
Given a unit and lesson number, generate all student-facing URLs for a lesson and copy them to clipboard.

## Usage
```bash
node scripts/lesson-urls.mjs --unit 6 --lesson 4
```

## Output format
Print to stdout AND copy to clipboard:
```
=== Lesson 6.4 URLs ===

Worksheet:  https://robjohncolson.github.io/apstats-live-worksheet/u6_lesson4_live.html
Drills:     https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l17-state-null
Quiz:       https://robjohncolson.github.io/curriculum_render/?u=6&l=3
Blooket:    [upload CSV to blooket.com and paste URL here]
```

## URL construction rules

1. **Worksheet**: `https://robjohncolson.github.io/apstats-live-worksheet/u{U}_lesson{L}_live.html`

2. **Drills**: `https://lrsl-driller.vercel.app/platform/app.html?c={cartridge-id}&level={first-new-mode-id}`
   - To determine `cartridge-id`: map unit number to cartridge. Unit 6 = `apstats-u6-inference-prop`. Read the mapping from a config object in the script.
   - To determine `first-new-mode-id`: Read `C:/Users/ColsonR/lrsl-driller/cartridges/{cartridge-id}/manifest.json`, find the first mode whose `id` contains the lesson number pattern (e.g. for lesson 4, look for modes starting with `l17` or containing `64` or `6.4` or `state-null` etc). Heuristic: find modes added for this lesson by looking at the mode name containing the topic number like "6.4".

3. **Quiz**: `https://robjohncolson.github.io/curriculum_render/?u={U}&l={L-1}`
   - Quiz is typically for the PREVIOUS lesson (assign quiz 6.3 when teaching 6.4)
   - Special case: if lesson is 1, there may be no quiz (skip or use previous unit's last lesson)

4. **Blooket**: Cannot be auto-generated (comes from blooket.com after upload). Print a placeholder.

## Clipboard
- On Windows, pipe to `clip.exe` to copy all URLs to clipboard
- Use `child_process.execSync` to run clip

## Cartridge mapping config
Include this in the script:
```js
const CARTRIDGE_MAP = {
  "5": "apstats-u5-sampling-dist",
  "6": "apstats-u6-inference-prop",
  // extend as new cartridges are added
};
```

## Parse args
Use `process.argv` — no external dependencies needed. Support `--unit` / `-u` and `--lesson` / `-l`.

## Do NOT
- Add npm dependencies
- Create multiple files (single self-contained script)
- Modify any existing files
