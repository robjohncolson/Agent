# Agent: package-json

## Task

Edit `package.json` to add the `prompts` dependency and a `start` script that launches the TUI menu.

## Current state

`package.json` currently contains:
```json
{
  "dependencies": {
    "playwright": "^1.58.2"
  }
}
```

## Required changes

1. Add `"name": "agent-lesson-prep"` field
2. Add `"type": "module"` field (all scripts use ESM imports)
3. Add `"start": "node scripts/menu.mjs"` to a new `"scripts"` block
4. Add `"prompts": "^2.4.2"` to the existing `"dependencies"` block

## Expected result

```json
{
  "name": "agent-lesson-prep",
  "type": "module",
  "scripts": {
    "start": "node scripts/menu.mjs"
  },
  "dependencies": {
    "playwright": "^1.58.2",
    "prompts": "^2.4.2"
  }
}
```

## Constraints

- Do NOT delete the existing `playwright` dependency
- Do NOT add any other dependencies
- Do NOT create a `package-lock.json` or run `npm install` (a later agent handles that)
- Only modify `package.json`, no other files
