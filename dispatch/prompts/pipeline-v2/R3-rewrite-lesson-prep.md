# R3: Rewrite lesson-prep.mjs

## File to rewrite
`C:/Users/ColsonR/Agent/scripts/lesson-prep.mjs`

## Read first
1. The current script to understand existing structure
2. `C:/Users/ColsonR/Agent/design/lesson-prep-workflow-spec-v2.md` — the authoritative pipeline spec
3. `C:/Users/ColsonR/Agent/scripts/whats-tomorrow.mjs` — Step 1
4. `C:/Users/ColsonR/Agent/scripts/aistudio-ingest.mjs` — Step 2
5. `C:/Users/ColsonR/Agent/scripts/render-animations.mjs` — Step 4 (just created by R2)
6. `C:/Users/ColsonR/lrsl-driller/scripts/upload-animations.mjs` — Step 5 (just rewritten by R1)
7. `C:/Users/ColsonR/Agent/scripts/lesson-urls.mjs` — Step 6

## The new pipeline (from spec v2)

```
Step 1: whats-tomorrow.mjs (if --auto)
Step 2: aistudio-ingest.mjs via CDP (interactive — user picks Drive files)
Step 3: Parallel content generation (two codex --full-auto sessions)
Step 4: render-animations.mjs
Step 5: upload-animations.mjs
Step 6: lesson-urls.mjs
Step 7: Print manual checklist (Blooket upload, Schoology posting)
```

## Usage
```bash
node scripts/lesson-prep.mjs --auto
# or
node scripts/lesson-prep.mjs --unit 6 --lesson 5 \
  --drive-ids "ID1" "ID2"
```

## Implementation

### Args
- `--unit` / `-u` — unit number
- `--lesson` / `-l` — lesson number
- `--drive-ids` — Google Drive file IDs for videos
- `--auto` — detect unit+lesson from whats-tomorrow.mjs, prompt for drive IDs
- `--skip-ingest` — skip Step 2 (video context files already exist)
- `--skip-render` — skip Step 4
- `--skip-upload` — skip Step 5

### Step 1 (--auto mode)
Run `whats-tomorrow.mjs`, parse output for unit+lesson. Display the calendar.

### Step 2 (CDP video ingest)
If `--drive-ids` provided or prompted:
```js
execSync(`node "${SCRIPTS.aistudioIngest}" --unit ${unit} --lesson ${lesson} --drive-ids ${driveIds.join(' ')}`, { stdio: 'inherit' });
```
This is interactive (user picks files in Drive picker), so it MUST run with `stdio: 'inherit'`.

If `--skip-ingest` or no drive IDs provided, skip.

### Step 3 (parallel content generation)
Spawn two codex `--full-auto` sessions in parallel:

Session 1 (apstats-live-worksheet):
```
Generate a follow-along worksheet, AI grading prompts, and Blooket CSV for Topic {U}.{L}. Read the video context files in u{U}/ for the lesson content. Follow the patterns established by existing worksheets.
```

Session 2 (lrsl-driller):
```
Extend the apstats-u6-inference-prop cartridge with Topic {U}.{L} modes and generate Manim animations. Read existing modes in manifest.json for the pattern. Add new modes, generator logic, grading rules, and animation .py files.
```

Wait for both to complete.

### Step 4 (render)
```js
execSync(`node "${SCRIPTS.renderAnimations}" --unit ${unit} --lesson ${lesson}`, { stdio: 'inherit' });
```

### Step 5 (upload)
```js
execSync(`node "${SCRIPTS.uploadAnimations}" --unit ${unit} --lesson ${lesson}`, { stdio: 'inherit', cwd: WORKING_DIRS.driller });
```

### Step 6 (URLs)
```js
execSync(`node "${SCRIPTS.lessonUrls}" --unit ${unit} --lesson ${lesson}`, { stdio: 'inherit' });
```

### Step 7 (checklist)
```
=== Remaining Manual Steps ===
[ ] Upload u{U}_l{L}_blooket.csv to blooket.com
[ ] Post all 4 links to Schoology
```

### Script paths
```js
const SCRIPTS = {
  whatsTomorrow: "C:/Users/ColsonR/Agent/scripts/whats-tomorrow.mjs",
  aistudioIngest: "C:/Users/ColsonR/Agent/scripts/aistudio-ingest.mjs",
  renderAnimations: "C:/Users/ColsonR/Agent/scripts/render-animations.mjs",
  uploadAnimations: "C:/Users/ColsonR/lrsl-driller/scripts/upload-animations.mjs",
  lessonUrls: "C:/Users/ColsonR/Agent/scripts/lesson-urls.mjs",
};

const WORKING_DIRS = {
  worksheet: "C:/Users/ColsonR/apstats-live-worksheet",
  driller: "C:/Users/ColsonR/lrsl-driller",
};
```

### Interactive prompt for Drive IDs (--auto mode)
If `--auto` and no `--drive-ids`, prompt:
```
Enter Google Drive file IDs for the video(s), separated by spaces:
Drive ID(s): _
```

## Do NOT
- Add npm dependencies
- Reference video-ingest.mjs (it's dormant)
- Modify any other files

After creating, verify with `node --check`.
