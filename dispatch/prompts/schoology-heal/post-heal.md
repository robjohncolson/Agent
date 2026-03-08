# Agent: post-heal

## Task

Add a `--heal` flag to `scripts/post-to-schoology.mjs` that enables auto-heal mode: pre-audit the Schoology folder, skip links that already exist, post only what's missing, verify each posted link, and update per-link status in the registry.

## File to modify

`scripts/post-to-schoology.mjs` (727 lines)

## Architecture context

The script currently posts ALL links every time. If it crashes mid-posting (Ctrl+C, browser timeout, etc.), re-running creates duplicates. The `--heal` flag makes it idempotent:

1. Pre-audit: scrape the Schoology folder to see what already exists
2. Filter: skip links already present in the folder
3. Post: only post missing links
4. Verify: after posting each link, confirm it appears in the DOM
5. Registry: update `schoologyLinks` per-link status via `updateSchoologyLink()`

## New imports needed

Add at the top (after existing imports):

```js
import { auditSchoologyFolder, buildExpectedLinks, verifyPostedLink } from "./lib/schoology-heal.mjs";
import { updateSchoologyLink } from "./lib/lesson-registry.mjs";
```

Note: `updateSchoologyLink` needs to be added to the existing import from `./lib/lesson-registry.mjs`. The current import (line 34) is:
```js
import { getLesson, updateStatus, updateUrl } from "./lib/lesson-registry.mjs";
```
Update it to:
```js
import { getLesson, updateStatus, updateUrl, updateSchoologyLink } from "./lib/lesson-registry.mjs";
```

## Changes

### 1. Add `--heal` to `parseArgs()` (around line 57)

Add a `heal` variable initialized to `false`, and add this in the arg parsing loop:

```js
} else if (arg === "--heal") {
  heal = true;
```

Add `heal` to the return object. Also add it to the help text:

```
"  --heal            Heal mode: audit folder, post only missing links, verify\n" +
```

### 2. Modify `main()` — heal-mode logic (around line 462)

After building the `links` array and before the dry-run check (line 613), add the heal-mode audit:

When `opts.heal` is true AND we have a `materialsUrl` (either from `--target-folder` or from the registry's `schoologyFolder`):

```js
  // --heal mode: determine materialsUrl from registry if not explicit
  if (opts.heal && !opts.targetFolder) {
    const regEntry = getLesson(unit, lesson);
    if (regEntry?.urls?.schoologyFolder) {
      materialsUrl = regEntry.urls.schoologyFolder;
      console.log(`  [heal] Using folder from registry: ${materialsUrl}`);
    }
  }
```

This needs to go AFTER the `materialsUrl` is initially set but BEFORE the folder creation logic. Place it right after `let materialsUrl = rootMaterialsUrl;` (line 626).

### 3. Add pre-audit in heal mode (after folder setup, before the posting loop)

After the folder creation/selection block (after line 645) and before the posting loop (line 648), insert:

```js
  // --heal mode: audit folder and filter out existing links
  if (opts.heal && materialsUrl !== rootMaterialsUrl) {
    console.log(`\n[heal] Auditing Schoology folder...`);
    const audit = await auditSchoologyFolder(page, materialsUrl, links);

    console.log(`  Found ${audit.existing.length} existing link(s) in folder`);
    console.log(`  Matched: ${audit.matched.length}, Missing: ${audit.missing.length}`);

    // Update registry for matched (already-posted) links
    for (const m of audit.matched) {
      updateSchoologyLink(unit, lesson, m.key, {
        status: "done",
        postedAt: new Date().toISOString(),
        title: m.title,
        verifiedExisting: true,
      });
      console.log(`  [heal] ✓ ${m.key} already posted`);
    }

    // Replace links array with only the missing ones
    links = audit.missing;

    if (links.length === 0) {
      console.log(`\n[heal] All links already present. Nothing to post.`);
      // Update overall status
      updateStatus(unit, lesson, "schoology", "done");
      if (browser) await browser.close();
      return;
    }

    console.log(`\n[heal] Will post ${links.length} missing link(s):`);
    for (const link of links) {
      console.log(`  [${link.key}] "${link.title}"`);
    }
    console.log();
  }
```

### 4. Add per-link registry updates and verification in the posting loop

Modify the posting loop (lines 648-667). After `successCount++` (line 656), add verification and registry update:

```js
      // --heal mode: verify and update per-link registry
      if (opts.heal) {
        const verified = await verifyPostedLink(page, link.title, materialsUrl);
        updateSchoologyLink(unit, lesson, link.key, {
          status: verified ? "done" : "failed",
          postedAt: new Date().toISOString(),
          title: link.title,
          verified,
        });
        if (verified) {
          console.log(`  [heal] ✓ Verified: "${link.title}" appears in folder`);
        } else {
          console.log(`  [heal] ⚠ Posted but not verified: "${link.title}"`);
        }
      }
```

And in the catch block (after `failCount++`, line 659), add:

```js
      // --heal mode: record failure in per-link registry
      if (opts.heal) {
        updateSchoologyLink(unit, lesson, link.key, {
          status: "failed",
          error: err.message,
          attemptedAt: new Date().toISOString(),
          title: link.title,
        });
      }
```

### 5. Folder handling: `--heal` + existing folder URL = use directly

This is already handled by change #2 above — when `--heal` is set and the registry has `schoologyFolder`, we use it directly. No `--create-folder` needed.

## Constraints

- Only modify `scripts/post-to-schoology.mjs`
- Do NOT change the existing non-heal behavior — all changes should be gated behind `opts.heal`
- The script must still work exactly as before when `--heal` is not passed
- Import `auditSchoologyFolder`, `buildExpectedLinks`, `verifyPostedLink` from `./lib/schoology-heal.mjs`
- Import `updateSchoologyLink` from `./lib/lesson-registry.mjs` (add to existing import)

## Verification

```bash
node --check scripts/post-to-schoology.mjs
node scripts/post-to-schoology.mjs --help  # should show --heal in help text
```
