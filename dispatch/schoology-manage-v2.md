# schoology-manage v2 — Dependency Graph & Dispatch Plan

## Dependency Graph

```
Layer 0 (no deps):
  [A] scripts/lib/schoology-dom.mjs — shared DOM helpers

Layer 1 (all depend on A, parallel):
  [B] list + tree commands
  [C] create-folder command
  [D] move-folder command
  [E] post-link command

Layer 2 (depends on B,C,D,E):
  [F] CLI entrypoint (arg parsing, wiring, cleanup)
```

## Execution Plan

1. **CC writes Task A** directly (requires exact proven selectors from live probing — not delegatable)
2. **Spawn 4 parallel Codex agents** for Tasks B, C, D, E (each writes a single exported async function)
3. **CC writes Task F** (CLI entrypoint, integrates all functions, deletes workahead script)
4. **CC commits and pushes**

---

## Task A: `scripts/lib/schoology-dom.mjs` (CC writes)

Extract proven DOM helpers from schoology-workahead.mjs. All functions take a Playwright `page` and return results. Use only native DOM selectors inside `page.evaluate()`.

## Task B Prompt: list + tree

```
You are implementing the `list` and `tree` commands for a Schoology folder management CLI.

INPUT: You will read `scripts/lib/schoology-dom.mjs` which exports DOM helper functions.

OUTPUT: Write `scripts/lib/schoology-commands-list.mjs` that exports:
- `cmdList(page, courseId, { inFolder, recursive })` — list items at a folder level
- `cmdTree(page, courseId, { depth })` — recursive tree view

REQUIREMENTS:
- Import helpers from `./schoology-dom.mjs`
- `cmdList` navigates to the folder (or top level if inFolder is null), calls `listItems()`, and prints results
- `inFolder` can be a name (string) or numeric ID — if string, resolve by navigating to top level and finding it
- If `--recursive`, recurse into subfolders
- `cmdTree` calls `cmdList` recursively with tree-drawing characters (├── └── │)
- Print format: `[folder] [ID] name (color)` or `[link] [ID] name`
- `depth` defaults to Infinity
- All async functions, all take `page` as first arg
```

## Task C Prompt: create-folder

```
You are implementing the `create-folder` command for a Schoology folder management CLI.

INPUT: You will read `scripts/lib/schoology-dom.mjs` which exports DOM helper functions.

OUTPUT: Write `scripts/lib/schoology-commands-create.mjs` that exports:
- `cmdCreateFolder(page, courseId, { name, inFolder, color })` — create a folder

REQUIREMENTS:
- Import helpers from `./schoology-dom.mjs`
- If `inFolder` is specified, navigate into that parent first (resolve by name or ID)
- If `inFolder` is null, create at top level
- Call `clickAddMaterials()`, `clickAddFolder()`, wait for popup
- Fill title via `fillFolderForm(page, { name, color })`
- Submit via `submitPopup(page)`
- After creation, verify the folder appears in the listing
- Print success with folder ID, or error with available folders
- `color` defaults to "blue". Valid: blue,red,orange,yellow,green,purple,pink,black,gray
- Idempotent: if folder with same name already exists, skip and print message
```

## Task D Prompt: move-folder

```
You are implementing the `move-folder` command for a Schoology folder management CLI.

INPUT: You will read `scripts/lib/schoology-dom.mjs` which exports DOM helper functions.

OUTPUT: Write `scripts/lib/schoology-commands-move.mjs` that exports:
- `cmdMoveFolder(page, courseId, { name, into, from })` — move a folder into another

REQUIREMENTS:
- Import helpers from `./schoology-dom.mjs`
- `from` specifies parent folder to find source in (null = top level). Can be name or ID.
- Navigate to the `from` folder, find the source folder row by name
- Call `openGearMenu(page, rowId)` then `clickMoveOption(page, rowId)`
- Wait for popup, call `selectMoveTarget(page, targetName)` on `#edit-destination-folder`
- The dropdown uses `--` indentation per nesting level. Strip leading dashes/spaces when matching.
- Call `submitMovePopup(page)`
- Print success or error (if source not found, list available folders; if target not in dropdown, list dropdown options)
```

## Task E Prompt: post-link

```
You are implementing the `post-link` command for a Schoology folder management CLI.

INPUT: You will read `scripts/lib/schoology-dom.mjs` which exports DOM helper functions.

OUTPUT: Write `scripts/lib/schoology-commands-postlink.mjs` that exports:
- `cmdPostLink(page, courseId, { title, url, inFolder })` — post a link material

REQUIREMENTS:
- Import helpers from `./schoology-dom.mjs`
- Navigate into `inFolder` (required — resolve by name or ID)
- Call `clickAddMaterials()`, `clickAddFileLink()`, `clickLinkOption()`
- Wait for popup, call `fillLinkForm(page, { title, url })`
- Submit via `submitPopup(page)`, wait for close (handle navigation-destroyed context)
- After submit, re-navigate into the folder if the page URL changed
- Print success with link title
```

## Task F: CLI entrypoint (CC writes)

Rewrite `scripts/schoology-manage.mjs` main() to:
- Parse args for: list, tree, create-folder, move-folder, post-link
- Import command functions from the 4 command modules
- Connect via CDP, dispatch to the right command, disconnect
- Delete `scripts/schoology-workahead.mjs`
