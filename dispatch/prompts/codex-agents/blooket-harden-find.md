# Agent: Harden find-blooket-set.mjs

Refactor `scripts/find-blooket-set.mjs` to use shared helpers and fix the garbled title scraping.

## Context

This script searches the Blooket dashboard for sets by keyword. It works but has two problems:
1. Set titles are garbled because `.textContent` grabs CSS from inline `<style>` tags inside card containers.
2. It duplicates scroll/cookie logic that should come from the shared helpers.

## Hard Constraints

- Modify ONLY: `scripts/find-blooket-set.mjs`
- DEPENDS ON `scripts/lib/blooket-helpers.mjs` existing (created by the `blooket-shared-helpers` agent).
- Import: `import { dismissCookieBanner, scrollToLoadAll } from "./lib/blooket-helpers.mjs";`
- Do NOT modify any other files.

## Deliverables

### 1. Fix title extraction

The current scraper grabs `.textContent` from set containers, which includes CSS from `<style>` tags embedded in the cards.

Fix: When extracting title from a set card, strip `<style>` and `<script>` tag content first:

```js
const title = el.cloneNode(true);
title.querySelectorAll("style, script").forEach(s => s.remove());
return title.textContent.trim();
```

Or more precisely, look for the specific title element. On the My Sets page, set cards (`_setContainer_3l2cj_141`) contain a child with class `_setQuestionsText` for question count. The set title is in a separate child. Extract the set name from the non-metadata text nodes — look for children that are NOT question count, play count, or edit date.

The visible text on each card follows this structure:
```
Blooket
{N} Questions
{title}
{N} Plays
Edited {time} ago
```

So the title is the 3rd text segment. A reliable approach: split the container's cleaned text by newlines, and take the line that isn't "Blooket", doesn't match `\d+ Questions`, `\d+ Plays`, or `Edited .* ago`.

### 2. Use shared helpers

- Replace inline cookie dismissal with `dismissCookieBanner(page)`.
- Replace the hardcoded scroll loop with `scrollToLoadAll(page)`.

### 3. Add `--json` output flag

When `--json` is passed, output a JSON array instead of human-readable text:

```json
[
  {
    "id": "69aa45856790eef16f71aebb",
    "title": "AP Stats 6.5 p-Values Review",
    "questionCount": 35,
    "url": "https://dashboard.blooket.com/set/69aa45856790eef16f71aebb"
  }
]
```

Parse `--json` in the arg handling (currently just `process.argv[2]` for keyword). Change to:
- `process.argv[2]` — keyword (or `--json`)
- If first arg is `--json`, set `jsonMode = true` and use `process.argv[3]` as keyword.

### 4. Keep existing human-readable output as default

The `--json` flag is additive. Without it, behavior is identical to current (minus the garbled titles).
