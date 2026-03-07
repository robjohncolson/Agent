# Step 2 Content Generation — Refactor Spec

## Problem

`lesson-prep.mjs` Step 2 spawns OpenAI Codex CLI as a subprocess to generate lesson content. This fails because:
1. Codex CLI needs a real TTY (`stdin is not a terminal`)
2. The prompts are one-liners that assume the LLM will explore the repo — no structured context is passed
3. There's no validation that output files were actually created

## Solution

Replace `launchCodexSession()` + `step2_contentGeneration()` with a function that writes **self-contained prompt files** and spawns Codex using `codex exec` (non-interactive mode). Each prompt file contains all the context the model needs inline — no repo exploration required.

### Three independent tasks (can run in parallel)

| Task | Output file(s) | Working directory |
|------|----------------|-------------------|
| **Worksheet** | `u{U}_lesson{L}_live.html`, `ai-grading-prompts-u{U}-l{L}.js` | `apstats-live-worksheet` |
| **Blooket CSV** | `u{U}_l{L}_blooket.csv` | `apstats-live-worksheet` |
| **Drills** | Modes appended to `manifest.json` | `lrsl-driller` |

### Architecture

```
lesson-prep.mjs step2_contentGeneration(unit, lesson)
  |
  |-- For each task:
  |     1. Build a detailed prompt string (see Prompt Templates below)
  |     2. Inline the video context files (transcription + slides for each video)
  |     3. Inline the relevant pattern file (most recent worksheet / CSV / manifest excerpt)
  |     4. Write prompt to a temp .md file in the working directory
  |     5. Spawn: codex exec --approval-mode full-auto -q "$(cat prompt.md)"
  |     6. On exit, verify output file(s) exist and have reasonable size
  |     7. Clean up temp prompt file
  |
  |-- Return results array with success/failure per task
```

### Spawn mechanics

Use `codex exec` which is explicitly non-interactive:

```js
const proc = spawn("bash", ["-c", `codex exec --approval-mode full-auto -q "$(cat '${promptFile}')" 2>&1`], {
  stdio: "inherit",
  cwd: workingDir,
});
```

If `codex exec` is not available (older CLI), fall back to:
```js
const proc = spawn("bash", ["-c", `cat '${promptFile}' | codex --full-auto 2>&1`], {
  stdio: ["pipe", "inherit", "inherit"],
  cwd: workingDir,
});
```

### Validation

After each task completes, check that the expected output files exist and are non-trivial:
- Worksheet HTML: > 10KB
- Grading prompts JS: > 1KB
- Blooket CSV: > 500 bytes, starts with `"Blooket`
- Drills manifest: contains a mode with the target lesson ID

If validation fails, mark the task as failed in results (don't silently continue).

---

## Prompt Templates

### Context block (shared by all three tasks)

All prompts start with this block, which embeds the video context inline:

```
## Video Context for Topic {U}.{L}: {topicTitle}

### Video 1 — Transcription
{contents of apstat_{U}-{L}-1_transcription.txt}

### Video 1 — Slide Descriptions
{contents of apstat_{U}-{L}-1_slides.txt}

### Video 2 — Transcription
{contents of apstat_{U}-{L}-2_transcription.txt}

### Video 2 — Slide Descriptions
{contents of apstat_{U}-{L}-2_slides.txt}
```

(If only 1 video exists, omit Video 2 sections.)

---

### Prompt 1: Worksheet + Grading Prompts

```
You are generating a follow-along worksheet for an AP Statistics class.
Create TWO files in the current directory:

1. `u{U}_lesson{L}_live.html` — the worksheet
2. `ai-grading-prompts-u{U}-l{L}.js` — the AI grading config

## Pattern to follow

Here is the COMPLETE source of the most recent worksheet (`u{U}_lesson{L-1}_live.html`).
Replicate this structure exactly — same CSS, same JS infrastructure, same HTML patterns.
Only change the content to match Topic {U}.{L}.

<file path="u{U}_lesson{L-1}_live.html">
{full contents of previous worksheet}
</file>

Here is the grading prompts file for the same lesson:

<file path="ai-grading-prompts-u{U}-l{L-1}.js">
{full contents of previous grading prompts}
</file>

## Video context (the actual lesson content)

{shared context block}

## Requirements

### Worksheet (HTML)
- Title: "Topic {U}.{L}: {topicTitle}"
- UNIT_ID constant: 'U{U}L{L}'
- One `<div class="section">` per video, with section header showing video title and timestamp range
- Questions use `<input type="text" class="blank" data-answer="...">` for fill-in-the-blank
  - data-answer accepts pipe-separated alternatives: `data-answer="reject|reject H0"`
  - Set width proportional to expected answer length
- Use `<div class="model-box">` for key formulas/rules the video presents
- Use `<div class="note-box">` for scenario/context setups
- Use `<textarea>` for open-ended reflection questions (exit ticket)
- Include timestamps `<span class="ts">[M:SS]</span>` from the transcription
- Questions should follow the video chronologically — students fill in as they watch
- 15-25 fill-in-the-blank questions across both videos
- 1 exit ticket (multi-part open-ended question) at the end
- Reference `ai-grading-prompts-u{U}-l{L}.js` in the script tag
- Keep the EXACT same CSS, JS infrastructure, button handlers, Railway integration, etc.

### Grading Prompts (JS)
- Define `window.LESSON_CONTEXT_U{U}L{L}` with a structured summary of both videos
- Define `window.RUBRICS_U{U}L{L}` with rubric entries for each reflection/textarea question
- Each rubric has: questionText, expectedElements (with id, description, required), scoringGuide
- Follow the exact pattern from the previous lesson's grading file
```

---

### Prompt 2: Blooket CSV

```
You are generating a Blooket review quiz CSV for AP Statistics Topic {U}.{L}.
Create ONE file: `u{U}_l{L}_blooket.csv`

## Format

The CSV must use the exact Blooket import template format. Here is a working example:

<file path="u{U}_l{L-1}_blooket.csv">
{first 10 rows of previous Blooket CSV}
</file>

Key format rules:
- Row 1: `"Blooket\nImport Template"` followed by empty cells (25 commas)
- Row 2: Headers — `Question #,Question Text,Answer 1,Answer 2,"Answer 3\n(Optional)","Answer 4\n(Optional)","Time Limit (sec)\n(Max: 300 seconds)","Correct Answer(s)\n(Only include Answer #)"` followed by empty cells
- Data rows: question number, question text in quotes, 4 answer choices in quotes, time limit (20), correct answer number (1-4), followed by empty cells (18 commas)
- Each row ends with `,,,,,,,,,,,,,,,,,,` (18 trailing commas)

## Video context (source material)

{shared context block}

## Requirements

- Generate 25-35 multiple choice questions covering ALL key concepts from BOTH videos
- Every answer choice must be a complete sentence (Blooket displays them in bubbles)
- Correct answer (Answer 1, 2, 3, or 4) should be RANDOMIZED — don't always put correct as Answer 1
- Wrong answers should be plausible misconceptions, not obviously absurd
- Questions should test:
  - Definitions and key vocabulary from the lesson
  - Procedural steps (what comes first, what do you check, etc.)
  - Common errors and misconceptions the video warns about
  - Application to the specific scenarios discussed in the videos
  - "Which of the following is correct/incorrect" style questions
- Time limit: 20 seconds for all questions
- Do NOT include any extra text, headers, or explanations — just the raw CSV
```

---

### Prompt 3: Drills (Cartridge Modes)

```
You are extending a drill cartridge for the lrsl-driller platform.
Edit `cartridges/apstats-u6-inference-prop/manifest.json` to add new modes for Topic {U}.{L}.

## Current manifest structure (modes array excerpt — last 2 modes)

{last 2 mode objects from manifest.json, showing the pattern}

## Video context (source material)

{shared context block}

## Requirements

- Add 3-5 new modes to the `modes` array in manifest.json
- Each mode needs:
  - `id`: kebab-case like `l{NN}-{skill-slug}` (continue numbering from last existing mode)
  - `name`: `"{U}.{L} — {Skill Description}"`
  - `skill`: AP Stats skill code (e.g., "DAT-3.A")
  - `generator`: references to generator.js functions that produce the question
  - `grading`: references to grading-rules.js for validation
  - `difficulty`: 1-3
- Also update `generator.js` to add generator functions for the new modes
- Also update `grading-rules.js` to add grading logic for the new modes
- Follow the exact patterns established by existing modes in the cartridge
- Update the `meta.name` and `meta.description` in manifest.json to include Topic {U}.{L} coverage
```

---

## Files to modify

### `scripts/lesson-prep.mjs`

1. Delete `launchCodexSession()` function
2. Rewrite `step2_contentGeneration()` to:
   - Read video context files from `apstats-live-worksheet/u{U}/`
   - Read pattern files (previous lesson's worksheet, CSV, grading prompts)
   - Build the three prompt strings using the templates above
   - Write each prompt to a temp file in the appropriate working directory
   - Spawn three parallel `codex exec` processes
   - Validate outputs after completion
   - Return results array

### New helper: `scripts/lib/build-codex-prompts.mjs`

Extract prompt building into a separate module for testability:
- `buildWorksheetPrompt(unit, lesson, videoContext, patternFiles)` -> string
- `buildBlooketPrompt(unit, lesson, videoContext, patternCSV)` -> string
- `buildDrillsPrompt(unit, lesson, videoContext, manifestExcerpt)` -> string
- `readVideoContext(unit, lesson)` -> { video1Transcription, video1Slides, video2Transcription, video2Slides }

---

## Verification checklist

After implementation, running this should produce all three artifacts:
```bash
node scripts/lesson-prep.mjs --auto --date 2026-03-10 --skip-ingest
```

Expected new files:
- `C:/Users/ColsonR/apstats-live-worksheet/u6_lesson7_live.html` (>10KB)
- `C:/Users/ColsonR/apstats-live-worksheet/ai-grading-prompts-u6-l7.js` (>1KB)
- `C:/Users/ColsonR/apstats-live-worksheet/u6_l7_blooket.csv` (>500B, 25+ questions)
- Updated modes in `C:/Users/ColsonR/lrsl-driller/cartridges/apstats-u6-inference-prop/manifest.json`
