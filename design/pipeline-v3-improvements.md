# Pipeline v3 Improvements Spec

**Author**: Agent (2026-03-05)
**Supersedes**: pipeline-v2 additions
**Context**: After first fully automated 6.5 cycle, these are the remaining friction points.

---

## Improvement 1: Full orchestrator integration

### Problem
`lesson-prep.mjs` doesn't include Blooket upload or Schoology posting. User has to run 3 separate commands after the orchestrator finishes.

### Solution
Add Steps 8-9 to `lesson-prep.mjs`:

```
Step 1: whats-tomorrow.mjs (if --auto)
Step 2: aistudio-ingest.mjs via CDP (user picks Drive files)
Step 3: Parallel content generation (worksheet + cartridge)
Step 4: render-animations.mjs
Step 5: upload-animations.mjs (Supabase)
Step 6: upload-blooket.mjs → get Blooket URL     ← NEW
Step 7: post-to-schoology.mjs --auto-urls         ← NEW
Step 8: lesson-urls.mjs (print + clipboard)
Step 9: Print summary
```

Steps 6-7 require CDP (Edge must be running). Since Step 2 already requires CDP, the browser session is available throughout.

### Implementation
Add to `lesson-prep.mjs`:
```js
// Step 6: Upload Blooket
let blooketUrl = null;
try {
  const output = execSync(`node "${SCRIPTS.uploadBlooket}" --unit ${unit} --lesson ${lesson}`, { encoding: "utf-8", stdio: "pipe" });
  const match = output.match(/https:\/\/dashboard\.blooket\.com\/set\/[a-z0-9]+/i);
  if (match) blooketUrl = match[0];
} catch (e) { console.log("Blooket upload skipped."); }

// Step 7: Post to Schoology
const blooketArg = blooketUrl ? `--blooket "${blooketUrl}"` : "";
execSync(`node "${SCRIPTS.postSchoolgy}" --unit ${unit} --lesson ${lesson} --auto-urls ${blooketArg}`, { stdio: "inherit" });
```

### Files to modify
- `Agent/scripts/lesson-prep.mjs`

---

## Improvement 2: Save worksheet + cartridge generation prompts

### Problem
The Blooket prompt is saved as a reusable template (`dispatch/prompts/blooket-generation-prompt.md`), but the worksheet and cartridge generation prompts are ad-hoc — typed inline when spawning agents. This means quality varies across lessons.

### Solution
Create two prompt template files:

**`dispatch/prompts/worksheet-generation-prompt.md`**
Template for generating the live worksheet HTML, AI grading prompts JS, and associated files. Should encode:
- Read video context files for content
- Follow exact HTML structure of existing worksheets
- Include video timestamps, reflection questions, exit ticket
- Railway backend integration for real-time class aggregation
- AI grading integration with E/P/I scoring
- Reference the Blooket generation prompt for the CSV

**`dispatch/prompts/cartridge-generation-prompt.md`**
Template for extending the lrsl-driller cartridge. Should encode:
- Read video context files for content
- Follow existing mode patterns in manifest.json
- Continue mode ID numbering from the last mode
- Add generator.js problem banks with diverse scenarios
- Add grading-rules.js with diagnostic feedback
- Update ai-grader-prompt.txt
- Generate Manim animation .py files following existing patterns
- Update cartridge name/description to reflect new topic range

### Files to create
- `Agent/dispatch/prompts/worksheet-generation-prompt.md`
- `Agent/dispatch/prompts/cartridge-generation-prompt.md`

---

## Improvement 3: Auto-detect Edge debug session

### Problem
Every CDP script fails silently or with a confusing error if Edge isn't running with `--remote-debugging-port=9222`. User has to remember to run `start-edge-debug.cmd` first.

### Solution
Create a shared CDP connection utility that all scripts import. Before connecting, it checks port 9222. If nothing is listening, it:

1. Attempts to launch Edge with the debug flag automatically
2. Waits for the port to become available (poll for ~10 seconds)
3. If Edge can't be launched (permissions), prints clear instructions and exits

**`Agent/scripts/lib/cdp-connect.mjs`**
```js
export async function connectCDP(chromium) {
  // Check if port 9222 is already listening
  const isListening = await checkPort(9222);

  if (!isListening) {
    console.log("No browser with debugging found on port 9222.");
    console.log("Launching Edge with remote debugging...");

    // Try to launch Edge
    const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    spawn(edgePath, ["--remote-debugging-port=9222", "--user-data-dir=C:\\Users\\ColsonR\\.edge-debug-profile"], { detached: true, stdio: "ignore" });

    // Wait for port
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      if (await checkPort(9222)) break;
    }
  }

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  return browser;
}
```

Then update `aistudio-ingest.mjs`, `post-to-schoology.mjs`, `upload-blooket.mjs` to import from this shared module.

### Files to create
- `Agent/scripts/lib/cdp-connect.mjs`

### Files to modify
- `Agent/scripts/aistudio-ingest.mjs`
- `Agent/scripts/post-to-schoology.mjs`
- `Agent/scripts/upload-blooket.mjs`

---

## Improvement 4: Schoology folder targeting

### Problem
Links are posted to the top level of the course materials page. The user organizes materials into day folders like "friday (3/6/26)" and has to manually drag the links into the right folder.

### Solution
After posting links, navigate to the correct day folder. The folder structure was discovered in the DOM probe:

```
Folder.Monday 3/2/26
Folder.tuesday (3/2/26)
Folder.thursday (3/5/26)
Folder.friday (3/6/26)
```

**Approach A (simple)**: Post links at top level, then use Schoology's drag-and-drop or move API to place them in the correct folder.

**Approach B (direct)**: Navigate into the target folder BEFORE clicking "Add Materials". Schoology may scope the "Add" action to the current folder.

**Approach C (folder URL)**: Schoology folder URLs look like `/course/{id}/materials?f={folder_id}`. If we can discover the folder ID for the target day, we navigate directly there before adding materials.

### Discovery needed
- Probe Schoology to find folder IDs for day folders
- Test whether adding materials while inside a folder scopes them to that folder
- Determine folder naming convention to auto-match tomorrow's date

### Files to modify
- `Agent/scripts/post-to-schoology.mjs`
- May need a new probe script

---

## Improvement 5: Auto-find AP Classroom videos in Google Drive

### Problem
The main remaining friction point is finding the correct video files in Google Drive. Videos are already recorded and uploaded, but filenames are sometimes not descriptive. The user has to open Google Drive, browse through files, and identify videos by their preview thumbnails.

### Solution
Build a Drive file index that maps AP Classroom topics to Drive file IDs.

### Approach: Build a Drive video catalog

**Step 1: Index all videos in the Drive folder**

Using the existing Edge CDP session (which is authenticated with Google), navigate to the Google Drive folder containing AP Classroom recordings. Extract all file names, IDs, and metadata.

Create `Agent/scripts/index-drive-videos.mjs`:
```js
// Connect to Edge via CDP
// Navigate to the Google Drive folder containing AP videos
// Extract: file name, file ID, thumbnail URL, last modified date, size
// Save to Agent/config/drive-video-index.json
```

The Drive file ID is extractable from the URL when viewing a file: `drive.google.com/file/d/{FILE_ID}/view`.

**Step 2: Match topics to videos**

Since filenames may not be descriptive, use one of these strategies:

**Strategy A: Gemini thumbnail analysis** (most robust)
- For each unidentified video in the index, use the AI Studio CDP flow to ask Gemini: "What AP Statistics topic does this video cover? Reply with just the topic number like 6.5"
- Cache the result in the index
- One-time cost: ~30 seconds per video × number of unindexed videos
- After initial indexing, new videos are identified incrementally

**Strategy B: Filename pattern matching** (fast but fragile)
- Parse filenames for topic numbers: "6.5", "Topic_6-5", "6-5", etc.
- Works if user has any naming convention at all
- Falls back to Strategy A for ambiguous names

**Strategy C: User-assisted catalog** (simplest)
- Show the user a list of unindexed videos with thumbnails
- User types the topic number for each
- One-time effort, then fully automated

### Recommended approach
**Strategy B first, Strategy A fallback.**
1. Index all files in the Drive folder
2. Try to match by filename patterns
3. For unmatched files, run them through Gemini for identification
4. Cache everything in `config/drive-video-index.json`

### Integration with lesson-prep.mjs
When `--auto` is used:
```
Step 0: whats-tomorrow → "Topic 6.5"
Step 0.5: Look up "6.5" in drive-video-index.json → ["DRIVE_ID_1", "DRIVE_ID_2"]
Step 2: aistudio-ingest.mjs --drive-ids DRIVE_ID_1 DRIVE_ID_2
```

No more manual Drive ID lookup. The user just runs `lesson-prep.mjs --auto` and everything flows.

### Config file: `Agent/config/drive-video-index.json`
```json
{
  "drive_folder_url": "https://drive.google.com/drive/folders/XXXXX",
  "last_indexed": "2026-03-05T20:00:00Z",
  "videos": [
    {
      "file_id": "1JE4_U3BNx90g66fasqu1yRNgslGkpwaI",
      "filename": "apclassroom_recording_feb28.mp4",
      "topic": "6.5",
      "topic_name": "Interpreting p-Values",
      "video_number": 1,
      "size_mb": 45.2,
      "identified_by": "filename_pattern"
    },
    {
      "file_id": "1_C9FAHoG_78nqXAcBh-REYx7a79zC7Cl",
      "filename": "apclassroom_recording_feb28_2.mp4",
      "topic": "6.5",
      "topic_name": "Interpreting p-Values",
      "video_number": 2,
      "size_mb": 38.7,
      "identified_by": "gemini_analysis"
    }
  ]
}
```

### Files to create
- `Agent/scripts/index-drive-videos.mjs`
- `Agent/config/drive-video-index.json`

### Files to modify
- `Agent/scripts/lesson-prep.mjs` (add Step 0.5 lookup)

---

## Dependency Graph

```
[1] Orchestrator integration ─── depends on existing scripts
[2] Save prompt templates ────── independent
[3] CDP auto-detect ──────────── independent, benefits 1
[4] Schoology folder targeting ─ needs DOM probing first
[5] Drive video catalog ──────── needs Drive folder URL from user

Parallel: 2, 3, 5 (independent)
Then: 1 (uses 3)
Then: 4 (needs more probing)
```

---

## Implementation Priority

1. **Save prompt templates** (2) — quick, improves consistency now
2. **CDP auto-detect** (3) — removes a friction step for every CDP script
3. **Drive video catalog** (5) — eliminates the last manual lookup step
4. **Orchestrator integration** (1) — one command for everything
5. **Schoology folder targeting** (4) — nice-to-have polish
