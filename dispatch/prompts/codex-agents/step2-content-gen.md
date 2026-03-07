# Codex Task: Refactor Step 2 Content Generation

## Your mission

Refactor `scripts/lesson-prep.mjs` so that Step 2 (content generation) works reliably by spawning Codex CLI with **self-contained prompt files** instead of bare one-liner prompts. The current approach fails because Codex CLI needs a TTY when spawned as a subprocess.

## Read first

1. `design/step2-content-gen-spec.md` — the full spec with prompt templates, architecture, and validation
2. `scripts/lesson-prep.mjs` — the pipeline orchestrator (lines 349-417 are the broken Step 2)
3. `C:/Users/ColsonR/apstats-live-worksheet/u6_lesson6_live.html` — example worksheet (the pattern to replicate)
4. `C:/Users/ColsonR/apstats-live-worksheet/ai-grading-prompts-u6-l6.js` — example grading prompts
5. `C:/Users/ColsonR/apstats-live-worksheet/u6_l6_blooket.csv` — example Blooket CSV
6. `C:/Users/ColsonR/lrsl-driller/cartridges/apstats-u6-inference-prop/manifest.json` — drills cartridge

## What to do

### 1. Create `scripts/lib/build-codex-prompts.mjs`

This module exports functions that build detailed, self-contained prompt strings:

- `readVideoContext(unit, lesson)` — reads all `apstat_{U}-{L}-*_transcription.txt` and `*_slides.txt` files from `C:/Users/ColsonR/apstats-live-worksheet/u{U}/`, returns an object with the text contents
- `buildWorksheetPrompt(unit, lesson, videoContext, patternFiles)` — builds the worksheet + grading prompt (see spec for template)
- `buildBlooketPrompt(unit, lesson, videoContext, patternCSV)` — builds the Blooket CSV prompt
- `buildDrillsPrompt(unit, lesson, videoContext, manifestExcerpt)` — builds the drills prompt

Each prompt must embed ALL context inline (video transcriptions, pattern files). The spawned Codex instance should NOT need to read any files to understand the task — everything is in the prompt.

### 2. Rewrite `step2_contentGeneration()` in `scripts/lesson-prep.mjs`

Replace the current implementation (delete `launchCodexSession` and rewrite `step2_contentGeneration`) with:

```js
async function step2_contentGeneration(unit, lesson) {
  // 1. Read video context files
  // 2. Read pattern files (previous lesson's worksheet, CSV, grading prompts, manifest excerpt)
  // 3. Build three prompt strings using build-codex-prompts.mjs
  // 4. For each task:
  //    a. Write prompt to temp .md file in the working directory
  //    b. Spawn: bash -c 'codex exec --approval-mode full-auto -q "$(cat prompt.md)" ; rm -f prompt.md'
  //    c. Collect exit code
  // 5. After all three complete, validate output files exist and have reasonable size
  // 6. Return results array
}
```

Key spawn pattern (avoids TTY and shell quoting issues):
```js
function launchCodexTask(label, promptFile, workingDir) {
  return new Promise((resolve) => {
    const promptPath = promptFile.replace(/\\/g, "/");
    const proc = spawn("bash", [
      "-c",
      `codex exec --approval-mode full-auto -q "$(cat '${promptPath}')" ; rm -f '${promptPath}'`
    ], {
      stdio: "inherit",
      cwd: workingDir,
    });
    // ... error/close handlers returning { label, success, error }
  });
}
```

### 3. Add output validation

After each Codex task completes, verify the expected files were created:

| Task | Expected file | Min size |
|------|--------------|----------|
| Worksheet | `u{U}_lesson{L}_live.html` | 10KB |
| Grading | `ai-grading-prompts-u{U}-l{L}.js` | 1KB |
| Blooket | `u{U}_l{L}_blooket.csv` | 500B |
| Drills | manifest.json contains `"{U}.{L}"` in a mode name | N/A |

Log validation results. Mark task as failed if validation fails even though Codex exited 0.

### 4. Handle edge cases

- If previous lesson files don't exist (e.g., lesson 1 of a new unit), use the most recent available worksheet as the pattern
- If only 1 video exists (no Video 2), omit Video 2 sections from the context block
- If `codex exec` is not a valid subcommand, try `codex --full-auto` with stdin pipe as fallback
- Clean up temp prompt files even on failure

## Constraints

- Do NOT modify any other pipeline steps (1, 3, 4, 5, 6, 7, 8)
- Do NOT change the function signature of `step2_contentGeneration(unit, lesson)` — it must still return a results array compatible with `step8_summary()`
- Keep existing imports; add new ones as needed (`path`, `writeFileSync`, etc. — some are already imported)
- The three tasks should run in parallel (Promise.all), not sequentially

## Test

After your changes, this command should get past Step 2 (assuming video context files exist for 6.7):
```bash
node scripts/lesson-prep.mjs --auto --date 2026-03-10 --skip-ingest
```
