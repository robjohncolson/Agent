# Agent: wire-orphan-cleanup

## Task

Wire orphan detection and cleanup into the `--heal` flow in `scripts/post-to-schoology.mjs`. When healing a lesson, scan the course root for orphaned links matching that lesson and delete them.

## File to modify

`scripts/post-to-schoology.mjs`

## Dependencies

This agent depends on `heal-utilities` completing first. That agent adds `deleteSchoologyLink()` and `findOrphanedLinks()` to `scripts/lib/schoology-heal.mjs`.

## Current import (line 35)

```js
import { auditSchoologyFolder, buildExpectedLinks, discoverLessonFolder, verifyPostedLink } from "./lib/schoology-heal.mjs";
```

### Change to:

```js
import { auditSchoologyFolder, buildExpectedLinks, deleteSchoologyLink, discoverLessonFolder, findOrphanedLinks, verifyPostedLink } from "./lib/schoology-heal.mjs";
```

(Add `deleteSchoologyLink` and `findOrphanedLinks` in alphabetical order within the existing import.)

## Current heal flow (lines 672-710)

```js
  // --heal mode: audit folder and filter out existing links
  if (opts.heal && materialsUrl === rootMaterialsUrl) {
    console.warn(`  [heal] ⚠ No folder found for ${unit}.${lesson}. Use --create-folder or --target-folder.`);
  } else if (opts.heal && materialsUrl !== rootMaterialsUrl) {
    console.log(`\n[heal] Auditing Schoology folder...`);
    const expectedLinks = links.length > 0 ? links : buildExpectedLinks(unit, lesson, { blooketUrl });
    const audit = await auditSchoologyFolder(page, materialsUrl, expectedLinks);
    // ... matched/missing logic, registry updates, early return if nothing to post ...
    console.log();
  }
```

## What to add

Insert the orphan cleanup block INSIDE the `else if (opts.heal && materialsUrl !== rootMaterialsUrl)` branch, AFTER the audit logging and BEFORE the posting loop. Specifically, insert it after the `console.log()` at the end of the audit block (just before the closing `}` of the else-if), and before the comment `// Post each link`.

The orphan cleanup should run after the folder audit (so we know which links are matched/missing) and before posting (so orphans are cleaned before new links go up).

### Code to insert:

```js
    // --heal mode: scan root for orphaned links and delete them
    console.log(`\n[heal] Scanning root for orphaned links...`);
    const orphans = await findOrphanedLinks(page, unit, lesson, rootMaterialsUrl);

    if (orphans.length > 0) {
      console.log(`  Found ${orphans.length} orphan(s) at root level:`);

      // Build set of titles that are safe to delete:
      // - already confirmed in folder (audit.matched)
      // - will be posted to folder (audit.missing / links)
      const safeTitles = new Set([
        ...audit.matched.map((m) => m.title.toLowerCase().trim()),
        ...links.map((l) => l.title.toLowerCase().trim()),
      ]);

      let deletedCount = 0;
      for (const orphan of orphans) {
        const orphanLower = orphan.title.toLowerCase().trim();
        const inFolder = audit.matched.some((m) => m.title.toLowerCase().trim() === orphanLower);
        const willPost = links.some((l) => l.title.toLowerCase().trim() === orphanLower);

        if (!inFolder && !willPost) {
          console.log(`    [orphan] "${orphan.title}" (${orphan.linkViewId}) — no folder copy, skipping`);
          continue;
        }

        const reason = inFolder ? "already in folder" : "will be posted to folder";
        console.log(`    [orphan] "${orphan.title}" (${orphan.linkViewId}) — ${reason}, deleting`);

        // Navigate back to root for deletion
        await page.goto(rootMaterialsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000);

        const result = await deleteSchoologyLink(page, orphan.linkViewId);
        if (result.deleted) {
          deletedCount++;
        } else {
          console.log(`    [orphan] Failed to delete: ${result.reason}`);
        }
      }

      if (deletedCount > 0) {
        console.log(`  [heal] Deleted ${deletedCount} orphan(s) from root.`);
      }
    } else {
      console.log(`  No orphaned links found at root.`);
    }
```

### Placement detail

The full block structure should look like this after the edit:

```js
  } else if (opts.heal && materialsUrl !== rootMaterialsUrl) {
    // ... existing audit code ...
    console.log();

    // NEW: orphan cleanup block goes here
    console.log(`\n[heal] Scanning root for orphaned links...`);
    // ... orphan cleanup code ...
  }

  // Post each link (inside folder if we navigated into one, else at top level)
```

IMPORTANT: The orphan cleanup code must have access to the `audit` variable (declared earlier in the same block), `links` (the filtered missing-links array), and `rootMaterialsUrl` (from the outer scope). All of these are already in scope.

IMPORTANT: After orphan deletion, the page will be at the root URL. The posting loop that follows will navigate to `materialsUrl` (the folder) for each link it posts, so no additional navigation is needed.

## Constraints

- Only modify `scripts/post-to-schoology.mjs`
- Do NOT change any existing non-heal behavior
- The orphan scan/delete is gated inside the `else if (opts.heal && materialsUrl !== rootMaterialsUrl)` block — it only runs when heal mode has a valid folder
- Do NOT delete orphans when no folder was found (the `if (opts.heal && materialsUrl === rootMaterialsUrl)` warning branch) — the orphan may be the only copy
- Keep alphabetical order in the import statement

## Verification

```bash
node --check scripts/post-to-schoology.mjs
```
