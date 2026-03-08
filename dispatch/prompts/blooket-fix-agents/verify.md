# Agent: verify

## Task

Verify all three modified files have correct syntax and contain the expected changes from the blooket-upload-fix spec.

## Steps

### 1. Syntax check all three files

```bash
node --check scripts/upload-blooket.mjs
node --check scripts/post-to-schoology.mjs
node --check scripts/lesson-prep.mjs
```

All three must pass with exit code 0.

### 2. Verify `scripts/upload-blooket.mjs` contains:

- A `findButton` function that takes `(page, strategies, label)` and iterates over selectors
- A `dumpPageState` function that logs URL, visible text, and button elements
- The "Spreadsheet Import" search uses multiple selector strategies (at least 4 different selectors)
- The "CSV Upload", "Create Set", and "Save Set" lookups also use multi-strategy cascades
- `dumpPageState(page)` is called before throwing errors when buttons aren't found
- All original functionality preserved (create → redirect → import → save flow)

### 3. Verify `scripts/post-to-schoology.mjs` contains:

- `noPrompt` variable in parseArgs
- `"--no-prompt"` flag handler in the arg parsing for loop
- `noPrompt` in the return object of parseArgs
- `opts.noPrompt || !process.stdin.isTTY` check before the `promptUser` call
- `regEntry?.status?.blooketUpload === "failed"` check before the auto-upload try/catch
- The `getLesson` import is still present (was already there)

### 4. Verify `scripts/lesson-prep.mjs` contains:

- In `step6_postToSchoology()`, the args array includes `--no-prompt`
- The line should look like: `const args = [..., '--no-prompt']` or similar

### 5. Fix any issues found

If syntax checks fail or expected changes are missing, fix them directly. Then re-run syntax checks.

## Constraints

- Only modify `scripts/upload-blooket.mjs`, `scripts/post-to-schoology.mjs`, and `scripts/lesson-prep.mjs`
- Do NOT modify any other files
- After fixes, re-run all syntax checks to confirm
