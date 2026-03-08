# Agent: schoology-scraper

## Goal

**CREATE** `scripts/scrape-schoology-urls.mjs` — a script that scrapes Schoology course materials to backfill the URL registry with historical lesson URLs.

## What it does

Connects to Edge via CDP (Chrome DevTools Protocol) on port 9222, navigates to the Schoology course materials page, walks each date folder, extracts link titles and URLs, parses unit/lesson from titles, and writes entries to the lesson registry.

## Usage

```
node scripts/scrape-schoology-urls.mjs [--dry-run] [--course-url <url>]
```

- `--dry-run`: Print what would be written to registry without actually writing
- `--course-url`: Override the default Schoology course materials URL

Default course URL: `https://lynnschools.schoology.com/course/7810966498/materials` (Period B — the lead section).

## Implementation

### 1. Connect to Edge via CDP + Playwright

```js
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const contexts = browser.contexts();
const context = contexts[0];
// Find or create a page
let page = context.pages().find(p => p.url().includes("schoology.com"));
if (!page) {
  page = await context.newPage();
}
```

### 2. Navigate to course materials

```js
await page.goto(courseUrl, { waitUntil: "networkidle", timeout: 30000 });
```

Check if we're on a login page (URL contains `/login` or page has a login form). If so, print error and exit.

### 3. Scrape folder structure

The Schoology materials page has folders listed as `<tr>` elements in a table. Each folder row has:
- A folder icon
- A title link (e.g., "Monday 3/16/26")
- The folder can be clicked to expand/navigate

Strategy:
1. Get all folder links on the materials page
2. For each folder, navigate to it (click the link or navigate to `?f=folderId`)
3. Inside the folder, find all material links
4. Extract titles and URLs from each link
5. Navigate back to the main materials page

### 4. Parse unit/lesson from link titles

Link titles follow patterns like:
- `"Topic 6.10 — Follow-Along Worksheet"` → unit 6, lesson 10, type "worksheet"
- `"Topic 6.10 — Drills"` or `"Topic 6.10 — Practice Drills"` → unit 6, lesson 10, type "drills"
- `"Topic 6.10 — Review Quiz"` or `"6.10 Quiz"` → unit 6, lesson 10, type "quiz"
- `"Topic 6.10 — Blooket"` or `"Blooket: Topic 6.10"` → unit 6, lesson 10, type "blooket"

Use a regex to extract unit/lesson: `/(?:Topic\s+)?(\d+)\.(\d+)/i`

Map the type based on keywords in the title:
- Contains "worksheet" or "follow-along" → `worksheet`
- Contains "drill" → `drills`
- Contains "quiz" → `quiz`
- Contains "blooket" → `blooket`

### 5. Write to registry

Import from the registry library:
```js
import { upsertLesson, updateUrl, updateStatus } from "./lib/lesson-registry.mjs";
```

For each extracted link:
```js
upsertLesson(unit, lesson, {
  topic: folderTitle,  // e.g., "Monday 3/16/26"
});
updateUrl(unit, lesson, urlType, linkUrl);
updateStatus(unit, lesson, stepKey, "scraped");
```

Map URL types to status keys:
- worksheet → status key "worksheet"
- drills → status key "drills"
- quiz → status key "worksheet" (quiz doesn't have its own status)
- blooket → status keys "blooketCsv" + "blooketUpload"
- schoology folder URL → "schoologyFolder" URL key

### 6. Rate limiting

Wait 1-2 seconds between page navigations to avoid Schoology throttling:
```js
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// Between folder navigations:
await sleep(1500);
```

### 7. Output

Print a summary of what was found/written:
```
Scraping Schoology materials from Period B...

Folder: Monday 3/16/26
  Topic 6.10 — Follow-Along Worksheet → worksheet
  Topic 6.10 — Practice Drills → drills
  Topic 6.10 — Review Quiz → quiz
  Topic 6.10 — Blooket → blooket

Folder: Wednesday 3/12/26
  Topic 6.9 — Follow-Along Worksheet → worksheet
  ...

Summary: Found 24 links across 8 folders. Updated 8 registry entries.
```

## Error handling

- If CDP connection fails: print helpful error about starting Edge with `--remote-debugging-port=9222`
- If not logged into Schoology: detect login page redirect, print error
- If a folder is empty or has no parseable links: skip silently
- Wrap each folder scrape in try/catch so one failure doesn't stop the whole run

## Imports

```js
import { chromium } from "playwright";
import { upsertLesson, updateUrl, updateStatus, loadRegistry, saveRegistry } from "./lib/lesson-registry.mjs";
```

## Constraints

- Use Playwright (already a project dependency)
- ES module syntax
- No other external dependencies
- Works on Windows (MSYS2/Git Bash)
- Rate limit navigations (1-2 second delay between folder visits)
