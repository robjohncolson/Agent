# Agent: Lesson Prep Pipeline Improvements

Modify `scripts/lesson-prep.mjs` to wire up Steps 3-4 properly, add incremental render validation after Step 2, and add a new commit/push step for downstream repos.

## Read first

1. `scripts/lesson-prep.mjs` — the full pipeline orchestrator (you will modify this)
2. `design/animation-pipeline-improvements-spec.md` — full spec (items #4, #5, #6)
3. `scripts/render-animations.mjs` — the render script (understand its output format)

## Changes Overview

You are making four changes to `scripts/lesson-prep.mjs`:
1. Improve `step3_renderAnimations` to pass `--quality m` and parse output
2. Improve `step4_uploadAnimations` to parse output
3. Add incremental render test after Step 2 completes
4. Add a new commit/push step for downstream repos (between Step 7 and summary)

---

### Change 1: Improve Step 3 (spec item #4)

Modify `step3_renderAnimations` (around line 826):

- Pass `--quality m` flag to render-animations.mjs (medium/720p instead of default low)
- Use `execSync` with `encoding: "utf-8"` instead of `stdio: "inherit"` to capture output
- Print the captured output with `process.stdout.write(output)` so the user still sees it
- Parse the summary line matching `/(\d+) succeeded, (\d+) failed/` from the output
- Return an object `{ success, rendered, failed }` instead of just boolean
- On catch, still return `{ success: false, rendered: 0, failed: 0 }`

Store the result in `results.renderResult` in `main()`.

### Change 2: Improve Step 4 (spec item #4)

Modify `step4_uploadAnimations` (around line 849):

- Use `execSync` with `encoding: "utf-8"` instead of `stdio: "inherit"` to capture output
- Print the captured output so the user sees it
- Return `{ success: true, output }` on success, `{ success: false }` on failure
- On catch, return `{ success: false }`

Store the result in `results.uploadResult` in `main()`.

### Change 3: Incremental render check after Step 2 (spec item #6)

After the `Promise.all` and validation loop in `step2_contentGeneration` (around line 813), add a post-validation substep:

1. Only run if the drills task succeeded (check `results` array for the "Drills Cartridge" entry)
2. Only run if `!opts.skipRender` (check if this flag needs to be passed — if not accessible, skip this guard)
3. Look for `.py` files in `C:/Users/ColsonR/lrsl-driller/animations/` matching `apstat_${unit}${lesson}_*.py`
4. If found, print `"  Testing ${count} animation file(s) with quick render..."`
5. Try a quick render: `execSync('node "C:/Users/ColsonR/Agent/scripts/render-animations.mjs" --unit ${unit} --lesson ${lesson} --quality l', { encoding: "utf-8", timeout: 120000 })`
6. Print the output
7. If render fails (catch block), log `"  Quick render test failed (non-blocking): ${error.message}"` but do NOT mark any task as failed
8. This is purely informational — it catches broken animation code early

Important: this goes INSIDE `step2_contentGeneration`, after validation but before the final `return results`. Add a try/catch so it never blocks the pipeline.

### Change 4: Add commit/push step (spec item #5)

#### 4a. Add `--auto-push` flag to `parseArgs`

In the `parseArgs` function, add:
- A new variable `let autoPush = false;`
- Parse `--auto-push` flag: `if (arg === "--auto-push") { autoPush = true; }`
- When `auto` is true, also set `autoPush = true` (add after the loop: `if (auto) autoPush = true;`)
- Add `autoPush` to the returned object
- Add it to the usage help string

#### 4b. Add `commitAndPushRepos` function

Add a new function after step7_lessonUrls:

```js
function commitAndPushRepos(unit, lesson, autoPush) {
  console.log("=== Step 8: Commit and push downstream repos ===\n");

  const repos = [
    {
      name: "apstats-live-worksheet",
      path: "C:/Users/ColsonR/apstats-live-worksheet",
      patterns: [
        "u*_lesson*_live.html",
        "u*_l*_blooket.csv",
        "ai-grading-prompts-*.js",
      ],
    },
    {
      name: "lrsl-driller",
      path: "C:/Users/ColsonR/lrsl-driller",
      patterns: [
        "animations/apstat_*.py",
        "cartridges/*/manifest.json",
        "cartridges/*/generator.js",
        "cartridges/*/grading-rules.js",
      ],
    },
  ];

  const repoResults = [];

  for (const repo of repos) {
    try {
      const status = execSync("git status -s", {
        cwd: repo.path,
        encoding: "utf-8",
      }).trim();

      if (!status) {
        console.log(`  ${repo.name}: no changes to commit`);
        repoResults.push({ name: repo.name, action: "clean" });
        continue;
      }

      console.log(`  ${repo.name}: found changes`);

      // Stage specific file patterns
      for (const pattern of repo.patterns) {
        try {
          execSync(`git add ${pattern}`, {
            cwd: repo.path,
            encoding: "utf-8",
          });
        } catch {
          // Pattern may not match any files — that's OK
        }
      }

      // Check if anything was staged
      const staged = execSync("git diff --cached --name-only", {
        cwd: repo.path,
        encoding: "utf-8",
      }).trim();

      if (!staged) {
        console.log(`  ${repo.name}: no matching files to stage`);
        repoResults.push({ name: repo.name, action: "nothing-staged" });
        continue;
      }

      const commitMsg = `pipeline: add U${unit} L${lesson} content`;
      const commitOutput = execSync(
        `git commit -m "${commitMsg}"`,
        { cwd: repo.path, encoding: "utf-8" }
      );
      const hashMatch = commitOutput.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
      const hash = hashMatch ? hashMatch[1] : "unknown";
      console.log(`  ${repo.name}: committed ${hash}`);

      if (autoPush) {
        try {
          execSync("git push", { cwd: repo.path, encoding: "utf-8", timeout: 30000 });
          console.log(`  ${repo.name}: pushed to origin`);
          repoResults.push({ name: repo.name, action: "pushed", hash });
        } catch (pushErr) {
          console.log(`  ${repo.name}: push failed: ${pushErr.message}`);
          repoResults.push({ name: repo.name, action: "committed", hash, pushError: pushErr.message });
        }
      } else {
        console.log(`  ${repo.name}: committed (dry-run, use --auto-push to push)`);
        repoResults.push({ name: repo.name, action: "committed", hash });
      }
    } catch (e) {
      console.error(`  ${repo.name}: error: ${e.message}`);
      repoResults.push({ name: repo.name, action: "error", error: e.message });
    }
  }

  console.log();
  return repoResults;
}
```

#### 4c. Wire into main() and update summary

In the `main()` function, BEFORE `step8_summary(unit, lesson, results)`:

1. Add: `results.repoCommits = commitAndPushRepos(unit, lesson, opts.autoPush);`
2. Also add `autoPush: opts.autoPush` to the `results` object initialization

Rename the existing `step8_summary` to `step9_summary` (function definition and ALL call sites — there are 3: lines ~1185, ~1199, ~1241).

Update the JSDoc comment at the top of the file to include Step 8.

In the renamed `step9_summary`, add a section after Step 7 that reports commit/push results:

```js
// Step 8
if (results.repoCommits) {
  for (const rc of results.repoCommits) {
    if (rc.action === "pushed") {
      completed.push(`Step 8: ${rc.name} committed (${rc.hash}) and pushed`);
    } else if (rc.action === "committed") {
      completed.push(`Step 8: ${rc.name} committed (${rc.hash}) — not pushed`);
    } else if (rc.action === "clean") {
      skipped.push(`Step 8: ${rc.name} — no changes`);
    } else if (rc.action === "error") {
      failed.push(`Step 8: ${rc.name} — ${rc.error}`);
    }
  }
}
```

Also update the summary to report Step 3 render counts if `results.renderResult` exists.

## Constraints

- Modify ONLY `scripts/lesson-prep.mjs`
- Do NOT change steps 0, 0.5, 1, or 2's core content generation logic (only add the post-validation render test)
- Do NOT change steps 5, 6, or 7
- Keep all existing CLI flags working
- `execSync` and `spawn` are already imported — use them
- `existsSync`, `readdirSync` are already imported
