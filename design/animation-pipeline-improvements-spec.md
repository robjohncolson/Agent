# Animation Pipeline Improvements Spec

Post-mortem from the Unit 6 full-cartridge animation build (2026-03-06).
These changes address every friction point hit during that session.

---

## 1. Bake MiKTeX PATH into render script

**Problem:** `render-animations.mjs` only adds ffmpeg to the spawned process PATH. Every new session requires manually exporting the MiKTeX path.

**Fix:** Add MiKTeX bin directory to the `env.PATH` in `render-animations.mjs`, alongside ffmpeg.

```js
// render-animations.mjs — env setup
const MIKTEX_DIR = "C:/Program Files/MiKTeX/miktex/bin/x64";
env.PATH = FFMPEG_DIR + pathSep + MIKTEX_DIR + pathSep + (env.PATH || "");
```

**File:** `scripts/render-animations.mjs`

---

## 2. Asset name mapping table in manifest

**Problem:** The upload script matches rendered MP4 filenames to manifest asset names via heuristic substring matching. This fails when the Manim scene class name diverges from the expected asset name (e.g. `HypothesisErrorMuseum.mp4` vs `HypothesisErrors.mp4`), requiring manual file copies.

**Fix:** Add an optional `assetMap` to each cartridge manifest that explicitly maps scene class output names to asset filenames. The upload script checks this map first before falling back to heuristic matching.

```jsonc
// manifest.json — top-level field
"assetMap": {
  "HypothesisErrorMuseum": "HypothesisErrors",
  "CapstonePValueInterpretation": "Capstone65",
  "CapstoneFullSetup": "Capstone64",
  "TestStatisticZScore": "TestStatistic"
}
```

**Upload script change:** Before heuristic matching, check `manifest.assetMap[renderedStem]` for an explicit mapping.

**Files:** `cartridges/*/manifest.json`, `scripts/upload-animations.mjs`

---

## 3. Ban MathTex — use Text with Unicode

**Problem:** `MathTex` and `Tex` require a working LaTeX installation (pdflatex + dvisvgm). The 6.1-6.3 animations used MathTex and were unrenderable for weeks until MiKTeX was installed. Even with MiKTeX, dvisvgm version mismatches cause sporadic failures.

**Convention:** All new animations must use `Text()` with Unicode characters instead of `MathTex()` or `Tex()`.

### Unicode reference for common stats symbols

| Symbol | Unicode | Python |
|--------|---------|--------|
| H₀ | U+2080 | `"H\u2080"` |
| Hₐ | U+2090 | `"H\u2090"` |
| p̂ | U+0302 | `"p\u0302"` |
| p₀ | U+2080 | `"p\u2080"` |
| α | U+03B1 | `"\u03b1"` |
| β | U+03B2 | `"\u03b2"` |
| μ | U+03BC | `"\u03bc"` |
| σ | U+03C3 | `"\u03c3"` |
| ≠ | U+2260 | `"\u2260"` |
| ≤ | U+2264 | `"\u2264"` |
| ≥ | U+2265 | `"\u2265"` |
| → | U+2192 | `"\u2192"` |
| ✓ | U+2713 | `"\u2713"` |
| ✗ | U+2717 | `"\u2717"` |
| − | U+2212 | `"\u2212"` |

### Also avoid

- `NumberLine(include_numbers=True)` — renders tick labels via LaTeX. Use manual `Text` labels instead.
- `Axes(x_axis_config={"numbers_to_include": [...]})` — same issue.
- Any Manim method that internally calls `Tex` or `MathTex`.

### Pattern for axis labels without LaTeX

```python
axes = Axes(
    x_range=[0, 1, 0.1],
    y_range=[0, 10, 2],
    x_length=8, y_length=3,
    axis_config={"include_tip": False, "color": GREY_B},
)
for val in [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]:
    lbl = Text(f"{val:.1f}", font_size=14, color=GREY_B)
    lbl.next_to(axes.c2p(val, 0), DOWN, buff=0.1)
    axes.add(lbl)
```

**Enforcement:** Add a pre-render lint check that greps for `MathTex\(` and `Tex\(` in `.py` files and warns.

---

## 4. Wire Steps 3-4 into lesson-prep.mjs

**Problem:** `render-animations.mjs` and `upload-animations.mjs` exist but are not called by the pipeline orchestrator. Steps 3 and 4 in `lesson-prep.mjs` are stubs that look for files but don't invoke rendering or uploading.

**Fix:** After Step 2 (content generation) produces animation `.py` files:

- **Step 3:** Call `render-animations.mjs --unit U --lesson L --quality m` with MiKTeX+ffmpeg on PATH. Parse output for success/failure counts.
- **Step 4:** Call `upload-animations.mjs --unit U --lesson L` from the lrsl-driller directory. Parse output for upload counts.

Both steps are non-blocking (pipeline continues if they fail), but results are logged to the step summary.

**File:** `scripts/lesson-prep.mjs`

---

## 5. Add Step 8: Commit and push all repos

**Problem:** After a full pipeline run, changes in `apstats-live-worksheet` and `lrsl-driller` are left uncommitted. The user has to remember to commit and push manually.

**Fix:** Add a final pipeline step that:

1. For each repo (`apstats-live-worksheet`, `lrsl-driller`):
   - Run `git status -s` to check for uncommitted changes
   - If changes exist, stage relevant files (not `media/`, `node_modules/`, temp files)
   - Create a commit with a generated message: `"pipeline: add U{unit} L{lesson} content"`
   - Push to origin
2. Log all commit hashes and push results

**Safety:** The step should `--dry-run` by default and require `--auto-push` flag to actually push. The `--auto` flag on `lesson-prep.mjs` implies `--auto-push`.

**Repos and what to commit:**

| Repo | Path | Files to stage |
|------|------|----------------|
| apstats-live-worksheet | `C:/Users/ColsonR/apstats-live-worksheet` | `u*_lesson*_live.html`, `u*_l*_blooket.csv`, `ai-grading-prompts-*.js`, `u*/apstat_*_{slides,transcription}.txt` |
| lrsl-driller | `C:/Users/ColsonR/lrsl-driller` | `animations/apstat_*.py`, `cartridges/*/manifest.json`, `cartridges/*/generator.js`, `cartridges/*/grading-rules.js` |

**File:** `scripts/lesson-prep.mjs`

---

## 6. Render animations incrementally, not in batch

**Problem:** All 5 animation `.py` files were created first, then rendered as a batch. If a render fails (bad code, LaTeX issue), the error isn't discovered until all files are written.

**Fix:** In Step 2, after each Codex task writes a `.py` file, immediately attempt a test render (`-ql` low quality, fast). If it fails:
- Log the error
- Attempt a single auto-fix pass (common fixes: remove MathTex, fix import errors)
- Re-render
- If still failing, mark as broken and continue

This catches errors at creation time instead of discovery time.

**File:** `scripts/lesson-prep.mjs` (Step 2 post-validation)

---

## 7. Serialize lesson renders to avoid Tex cache lock

**Problem:** Parallel renders for different lessons (6.2 and 6.3 simultaneously) fight over the shared `media/Tex/` LaTeX cache directory, causing `PermissionError: [WinError 32]` file lock errors on Windows.

**Fix:** Two options (pick one):

### Option A: Sequential rendering (simpler)
Render lessons one at a time. Within a lesson, files are already rendered sequentially by the script.

### Option B: Isolated media dirs (faster)
Pass `--media_dir` to manim so each render job uses a separate output directory:
```js
["-m", "manim", "render", qualityFlag, "--media_dir", `media_${lesson}`, filepath]
```
Then consolidate outputs after all renders complete.

**Recommendation:** Option A. The time difference is small (renders take ~10s each) and the complexity of Option B isn't worth it.

**File:** `scripts/render-animations.mjs` or pipeline orchestration in `lesson-prep.mjs`

---

## Implementation Priority

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | Bake MiKTeX PATH (#1) | 5 min | Eliminates manual PATH export every session |
| 2 | Wire Steps 3-4 (#4) | 30 min | Automates render + upload in pipeline |
| 3 | Add Step 8 commit/push (#5) | 30 min | Eliminates forgotten commits |
| 4 | Ban MathTex convention (#3) | 10 min | Prevents future render failures |
| 5 | Incremental render (#6) | 45 min | Catches errors at creation time |
| 6 | Asset mapping table (#2) | 20 min | Eliminates manual file copies |
| 7 | Sequential renders (#7) | 10 min | Prevents file lock errors |
