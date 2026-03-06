# Schoology Link Posting via CDP — Spec

**Author**: Agent (2026-03-05)
**Status**: Draft
**Depends on**: Edge with `--remote-debugging-port=9222`, user logged into Schoology

---

## Problem

Posting 4 links to Schoology per lesson takes ~3-5 minutes of manual clicking through the Schoology UI. The Schoology API requires admin-provisioned OAuth keys which the teacher doesn't have access to. But we already have a working CDP connection to Edge from the AI Studio automation — we can reuse this to drive Schoology.

## Approach

Connect to the user's already-running Edge browser via CDP (same as `aistudio-ingest.mjs`), navigate Schoology's UI, and programmatically add 4 material links to the correct course section.

## Scope

### In scope
- Add "Link" type materials to a Schoology course section
- Support 4 link types: Worksheet, Drills, Quiz, Blooket
- Navigate to the correct course/section automatically
- Handle Schoology's Angular/React UI via CDP

### Out of scope
- Creating assignments with due dates/grading
- Modifying existing materials
- Grade syncing
- Any write operations beyond adding link materials

---

## User Flow

```bash
node scripts/post-to-schoology.mjs \
  --unit 6 --lesson 5 \
  --worksheet "https://robjohncolson.github.io/apstats-live-worksheet/u6_lesson5_live.html" \
  --drills "https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l24-test-statistic" \
  --quiz "https://robjohncolson.github.io/curriculum_render/?u=6&l=4" \
  --blooket "https://dashboard.blooket.com/set/xxx"
```

Or integrated into the pipeline:
```bash
node scripts/lesson-prep.mjs --auto
# ... steps 1-6 run ...
# Step 7: "Paste Blooket URL: ___"
# Step 8: auto-posts all 4 links to Schoology
```

---

## Prerequisites

1. Edge running with `--remote-debugging-port=9222` (already required for AI Studio)
2. User logged into Schoology in that Edge session
3. Course section ID configured (one-time setup)

---

## Configuration

### One-time setup: `schoology-config.json`

The user's courses/sections change per semester, not per lesson. Store in `Agent/config/schoology.json`:

```json
{
  "base_url": "https://lps.schoology.com",
  "courses": [
    {
      "label": "Period B",
      "course_id": "XXXXXXXXXX",
      "section_path": "/course/XXXXXXXXXX/materials"
    },
    {
      "label": "Period E",
      "course_id": "YYYYYYYYYY",
      "section_path": "/course/YYYYYYYYYY/materials"
    }
  ],
  "default_period": "Period B"
}
```

**Discovery**: On first run, the script can list available courses by scraping the Schoology sidebar/dashboard. The user picks their course, and the config is saved for future runs.

---

## Implementation Strategy

### Phase 1: DOM Discovery (probe first)

Before writing the full script, create `probe-schoology.mjs` (like `probe-aistudio.mjs`) to:
1. Connect via CDP
2. Navigate to a course materials page
3. Dump all buttons, links, and interactive elements
4. Find the "Add Materials" button and its dropdown options
5. Find the "Add Link" form fields

This is critical because Schoology's DOM structure is unknown and may use Angular/React components with dynamic selectors.

### Phase 2: Implementation

#### Step 1 — Connect via CDP
Same pattern as `aistudio-ingest.mjs`:
```js
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
```

#### Step 2 — Navigate to course materials page
```js
await page.goto(`${BASE_URL}/course/${courseId}/materials`);
```

#### Step 3 — Click "Add Materials" button
Schoology typically has an "Add Materials" or "Add Content" button at the top of the materials page. Click it to reveal the dropdown/dialog.

#### Step 4 — Select "Add Link" option
From the dropdown, select "Add Link" or "External URL" or similar.

#### Step 5 — Fill the form
For each of the 4 links:
1. Find the title field → enter title (e.g. "6.5 Follow-Along Worksheet")
2. Find the URL field → paste the URL
3. Click Save/Submit
4. Repeat for next link

#### Step 6 — Verify
Check that all 4 links appear in the materials list.

---

## Link Titles Convention

```
Topic {U}.{L} — Follow-Along Worksheet
Topic {U}.{L} — Blooket Review
Topic {U}.{L} — Drills
Quiz {U}.{L-1}
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Schoology UI changes | Script breaks | Use `probe-schoology.mjs` to re-discover selectors |
| CSP blocks CDP interaction | Can't automate | Test early — if blocked, fall back to manual |
| Session expired | Can't navigate | Detect login page, prompt user to re-login |
| Course structure varies | Wrong page | Config file with verified course IDs |
| "Add Link" flow varies by school config | Form fields differ | Probe tool discovers actual form structure |
| Rate limiting / abuse detection | Account flags | Add delays between operations, limit to 4 links per run |

---

## Implementation Order

1. **`probe-schoology.mjs`** — DOM discovery tool (must run first to find selectors)
2. **`config/schoology.json`** — one-time course setup (manual or auto-discovered)
3. **`post-to-schoology.mjs`** — the actual posting script
4. **Integration into `lesson-prep.mjs`** — add as Step 8

---

## Estimated Effort

- Probe tool: ~30 min
- Config setup: ~15 min
- Posting script: ~1-2 hours (depends on Schoology DOM complexity)
- Pipeline integration: ~15 min

**Time saved per lesson**: ~3-5 min of manual clicking → ~10 seconds automated

---

## Next Step

Run `probe-schoology.mjs` against a live Schoology session to discover the actual DOM structure. This determines whether the approach is feasible before investing in the full implementation.
