# Agent: verify-menu

## Task

Verify the TUI menu system was implemented correctly by running `npm install` and checking that `scripts/menu.mjs` loads without errors.

## Steps

1. **Run `npm install`** in the Agent repo root to install the `prompts` dependency.
   ```bash
   cd "C:/Users/rober/Downloads/Projects/Agent" && npm install
   ```

2. **Check that `scripts/menu.mjs` exists** and is a valid ES module by running:
   ```bash
   node -e "import('./scripts/menu.mjs').catch(e => { console.error(e.message); process.exit(1); })"
   ```
   Note: This will likely fail because the menu tries to run interactively, so instead just check syntax:
   ```bash
   node --check scripts/menu.mjs
   ```

3. **Verify `package.json`** contains:
   - `"type": "module"`
   - `"start": "node scripts/menu.mjs"` in scripts
   - `"prompts": "^2.4.2"` in dependencies
   - `"playwright"` still in dependencies

4. **Verify `scripts/menu.mjs`** contains:
   - Import of `loadRegistry` and `getLesson` from `./lib/lesson-registry.mjs`
   - Import of `SCRIPTS` and `AGENT_ROOT` from `./lib/paths.mjs`
   - Import of `prompts` from `prompts`
   - An `onCancel` handler
   - The main menu loop with all 7 options (prep tomorrow, prep specific, view status, get URLs, preflight, utility tools, quit)
   - Skip toggle multiselect logic
   - `execSync` calls with try/catch

5. **If any issues are found**, fix them directly:
   - Missing imports → add them
   - Syntax errors → fix them
   - Missing menu options → add them
   - Broken skip toggle logic → repair it

## Constraints

- Only modify `scripts/menu.mjs` and `package.json` (no other files)
- Do NOT restructure working code — only fix actual bugs
- After fixes, re-run `node --check scripts/menu.mjs` to confirm
