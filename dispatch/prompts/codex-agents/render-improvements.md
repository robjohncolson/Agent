# Agent: Render Script Improvements

Modify `scripts/render-animations.mjs` to address three issues from the animation pipeline post-mortem.

## Read first

1. `scripts/render-animations.mjs` — the current render script (you will modify this)
2. `design/animation-pipeline-improvements-spec.md` — full spec (items #1, #3, #7)

## Changes

### 1. Add MiKTeX to PATH (spec item #1)

The script already adds `FFMPEG_DIR` to the spawned process PATH (line 169). Add MiKTeX alongside it.

Add a new constant after the existing `FFMPEG_DIR` (line 12):

```js
const MIKTEX_DIR = "C:/Program Files/MiKTeX/miktex/bin/x64";
```

Then update the PATH construction (line 169) to include both:

```js
env.PATH = FFMPEG_DIR + pathSep + MIKTEX_DIR + pathSep + (env.PATH || "");
```

### 2. Add pre-render MathTex/Tex lint check (spec item #3)

Add `readFileSync` to the existing `node:fs` import on line 6.

Add a new function `lintAnimationFile(filepath)` that:
1. Reads the file contents with `readFileSync(filepath, "utf-8")`
2. Checks for these banned patterns (regex match on each line):
   - `/\bMathTex\s*\(/` — direct MathTex usage
   - `/\bTex\s*\(/` — direct Tex usage (but NOT `Text(`)
   - `/NumberLine\(.*include_numbers\s*=\s*True/` — NumberLine with LaTeX labels
   - `/numbers_to_include/` — Axes number rendering via LaTeX
3. Returns an array of warning strings like `"line 42: MathTex() usage — consider Text() with Unicode"`
4. Returns empty array if no issues found

Call this function in the main render loop (inside the `for (const pyFile of pyFiles)` block, before `renderFile()`). If warnings are returned, print each with a `⚠` prefix but do NOT skip the render.

### 3. Document sequential rendering (spec item #7)

Add a comment before the `for` loop at line 175:

```js
// Render files sequentially to avoid TeX cache lock conflicts on Windows
// (parallel renders for different lessons fight over media/Tex/ — see spec item #7)
```

## Constraints

- Modify ONLY `scripts/render-animations.mjs`
- Keep the existing CLI interface (`--unit`, `--lesson`, `--quality`, `--repo`) unchanged
- Do not add any new dependencies
