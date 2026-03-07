# Agent: Schoology --only Flag

Add an `--only` filter flag to `scripts/post-to-schoology.mjs` for single-link posting.

## Context

Currently you can post a single link by only passing e.g. `--blooket URL`, but the intent isn't clear from the command line. An `--only` flag makes single-link posting a documented first-class use case.

## Hard Constraints

- Modify ONLY: `scripts/post-to-schoology.mjs`
- Do NOT modify any other files.
- Do NOT break existing behavior — all current invocations must work identically.

## Deliverables

### 1. Add `--only <type>` argument

`type` is one of: `worksheet`, `drills`, `quiz`, `blooket`.

When `--only` is provided alongside `--auto-urls`:
- Auto-generate all URLs as usual.
- But filter the `links` array to only include the specified type before posting.

When `--only` is provided without `--auto-urls`:
- Behave the same as today (only explicitly provided URLs are posted). The `--only` flag is redundant here but shouldn't error.

### 2. Update the usage/help text

Add `--only` to the help output in the `parseArgs` error message:

```
  --only          Post only this link type (worksheet, drills, quiz, blooket)
```

### 3. Example usage after the change

```bash
# Post only the blooket link (auto-generate URL or provide explicitly)
node scripts/post-to-schoology.mjs --unit 6 --lesson 5 --auto-urls --only blooket

# Post only the worksheet
node scripts/post-to-schoology.mjs --unit 6 --lesson 5 --auto-urls --only worksheet

# Explicit URL still works without --auto-urls
node scripts/post-to-schoology.mjs --unit 6 --lesson 5 --only blooket --blooket "https://..."
```

### 4. Implementation hint

In `parseArgs`, add:
```js
} else if (arg === "--only") {
  only = args[++i];
}
```

Return `only` in the opts object. Then after the `links` array is fully built (around line 365), filter:
```js
if (opts.only) {
  const before = links.length;
  links = links.filter(l => l.key === opts.only);
  if (links.length === 0) {
    console.error(`Error: --only "${opts.only}" but no matching link was generated.`);
    process.exit(1);
  }
}
```
