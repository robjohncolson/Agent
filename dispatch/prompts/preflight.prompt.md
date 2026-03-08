# Agent: preflight

## Goal

**CREATE** `scripts/preflight.mjs` — a dependency and session checker for the lesson-prep pipeline.

## What it does

Runs a series of checks and prints a summary. No arguments needed.

```
$ node scripts/preflight.mjs

=== Pipeline Preflight Check ===

[Tools]
  [OK]   Node.js v22.17.1
  [OK]   Python: C:\Users\rober\scoop\shims\python.exe
  [OK]   FFmpeg: C:\Users\rober\scoop\shims\ffmpeg.exe
  [OK]   MiKTeX: C:\Users\rober\scoop\apps\miktex\current\...
  [OK]   Codex CLI: C:\Users\rober\AppData\Roaming\npm\...
  [FAIL] Playwright: not installed (run: npm install playwright)

[Repos]
  [OK]   apstats-live-worksheet: C:\Users\rober\Downloads\Projects\school\follow-alongs
  [OK]   lrsl-driller: C:\Users\rober\Downloads\Projects\school\lrsl-driller
  [OK]   curriculum_render: C:\Users\rober\Downloads\Projects\school\curriculum_render

[Browser (CDP port 9222)]
  [OK]   Edge DevTools protocol accessible
  [WARN] Schoology: not signed in
  [OK]   Blooket: signed in
  [OK]   AI Studio: signed in

Summary: 9 OK, 1 WARN, 1 FAIL
```

## Check categories

### 1. Tools

Check that these executables exist and are runnable:

| Tool | How to check | Import from |
|------|-------------|-------------|
| Node.js | `process.version` | built-in |
| Python | `PYTHON` from `paths.mjs`, verify with `--version` | `./lib/paths.mjs` |
| FFmpeg | `FFMPEG_DIR` from `paths.mjs`, check `ffmpeg` exists in that dir | `./lib/paths.mjs` |
| MiKTeX | `MIKTEX_DIR` from `paths.mjs`, check `pdflatex` exists in that dir | `./lib/paths.mjs` |
| Codex CLI | `which codex` or check `%APPDATA%/npm/node_modules/@openai/codex/bin/codex.js` | shell |
| Playwright | `import('playwright')` — if it throws, not installed | dynamic import |
| Edge | `EDGE_PATH` from `paths.mjs`, check file exists | `./lib/paths.mjs` |

For Python/FFmpeg/MiKTeX: if the paths.mjs value is `null` or empty, try `which`/`where` as fallback.

Use `child_process.execSync` with `{ stdio: 'pipe' }` for version checks. Wrap in try/catch.

### 2. Repos

Check that all downstream repo directories exist:

| Repo | Path source |
|------|-------------|
| apstats-live-worksheet | `WORKSHEET_REPO` from `paths.mjs` |
| lrsl-driller | `DRILLER_REPO` from `paths.mjs` |
| curriculum_render | `CURRICULUM_REPO` from `paths.mjs` |

Check: directory exists AND contains a `.git` directory (confirming it's a git repo).

### 3. Browser sessions (CDP)

Connect to Edge via CDP on port 9222. Use `http://localhost:9222/json` to list open pages.

If the CDP endpoint is not reachable, report `[FAIL] Edge not running with --remote-debugging-port=9222`.

If reachable, check the open tabs for login indicators:
- **Schoology**: Look for a tab with URL matching `*schoology.com*`. If found, it's `[OK]`. If not found, `[WARN] Not signed in (navigate to lynnschools.schoology.com)`.
- **Blooket**: Look for a tab with URL matching `*blooket.com*` that isn't a login/signup page. If found, `[OK]`. If not, `[WARN]`.
- **AI Studio**: Look for a tab with URL matching `*aistudio.google.com*`. If found, `[OK]`. If not, `[WARN]`.

For the CDP check, use `http` (Node built-in) to fetch `http://localhost:9222/json`. Parse the JSON response to get the list of tabs. Each tab has a `url` and `title` property.

```js
import http from "node:http";

function fetchCdpTabs() {
  return new Promise((resolve, reject) => {
    http.get("http://localhost:9222/json", (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("Invalid CDP response")); }
      });
    }).on("error", reject);
  });
}
```

### 4. Summary line

Count OK, WARN, FAIL across all checks. Print summary. Exit with code 0 if no FAILs, 1 if any FAILs.

## Implementation details

- Import paths from `./lib/paths.mjs`:
  ```js
  import {
    PYTHON, FFMPEG_DIR, MIKTEX_DIR, EDGE_PATH,
    WORKSHEET_REPO, DRILLER_REPO, CURRICULUM_REPO,
  } from "./lib/paths.mjs";
  ```
- Use `existsSync` for file/directory existence checks
- Use `execSync` with try/catch for version commands
- Use ANSI colors if stdout is a TTY: green for OK, yellow for WARN, red for FAIL
  - `\x1b[32m` green, `\x1b[33m` yellow, `\x1b[31m` red, `\x1b[0m` reset
  - Check `process.stdout.isTTY` before using colors
- The script should be runnable standalone: `node scripts/preflight.mjs`
- No external dependencies. ES module syntax.
- Make the main logic `async` (for the CDP fetch)

## Constraints

- No external dependencies (no npm packages)
- ES module syntax
- Works on Windows (MSYS2/Git Bash) — use forward slashes in displayed paths
