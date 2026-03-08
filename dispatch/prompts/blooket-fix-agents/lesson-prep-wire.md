# Agent: lesson-prep-wire

## Task

Edit `scripts/lesson-prep.mjs` to pass `--no-prompt` when invoking `post-to-schoology.mjs`, so the Schoology step never blocks on stdin during automated pipeline runs.

## File to modify

`scripts/lesson-prep.mjs`

## The change

In the `step6_postToSchoology()` function, find line 1164:

```js
const args = [`--unit ${unit}`, `--lesson ${lesson}`, `--auto-urls`, `--with-videos`];
```

Change it to:

```js
const args = [`--unit ${unit}`, `--lesson ${lesson}`, `--auto-urls`, `--with-videos`, `--no-prompt`];
```

That is the ONLY change needed. Just add `--no-prompt` to the args array.

## Context

`post-to-schoology.mjs` now accepts a `--no-prompt` flag (added by a prior agent). When present, it skips the `promptUser("Enter Blooket URL...")` call that would otherwise block on stdin.

`lesson-prep.mjs` calls `post-to-schoology.mjs` via `execSync` with `stdio: "inherit"`, but in automated contexts (TUI menu), stdin is not a real TTY. Adding `--no-prompt` ensures the Schoology step completes cleanly even when Blooket upload fails.

## Constraints

- Only modify `scripts/lesson-prep.mjs`
- Only change the ONE line described above
- Do NOT modify any other functions, steps, or logic
- Do NOT add new imports
- Valid ESM syntax
