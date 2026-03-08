# Agent: verify

## Task

Verify the "Prep next undeveloped" feature was implemented correctly. Run syntax checks and validate the code against the spec.

## Steps

1. **Syntax-check both files**:
   ```bash
   node --check scripts/lib/scan-calendars.mjs
   node --check scripts/menu.mjs
   ```
   Both must pass with exit code 0.

2. **Verify `scripts/lib/scan-calendars.mjs`** contains:
   - Import of `readdirSync`, `readFileSync` from `node:fs`
   - Import of `join` from `node:path`
   - Import of `CALENDAR_DIR` from `./paths.mjs`
   - Export of `scanCalendars` function
   - Regex for Period B block matching (class containing `period-b`)
   - Regex for topic tag extraction: `/(\d+)\.(\d+)/`
   - Date resolution using year 2026
   - Deduplication by unit.lesson key
   - Sort by date ascending

3. **Verify `scripts/menu.mjs`** contains:
   - Import of `scanCalendars` from `./lib/scan-calendars.mjs`
   - `prepNextUndeveloped` async function
   - Main menu has "Prep next undeveloped" as the FIRST choice (value `"next"`)
   - Switch statement includes `case "next"`
   - The function calls `scanCalendars()`, diffs against registry, shows select list
   - Uses existing `showSkipToggles()`, `buildSkipArgs()`, `runScript()`
   - All `prompts()` calls use `{ onCancel }`

4. **Functional smoke test** — run the scanner to verify it finds lessons:
   ```bash
   node -e "import { scanCalendars } from './scripts/lib/scan-calendars.mjs'; const r = scanCalendars(); console.log('Found ' + r.length + ' lessons'); console.log('First:', JSON.stringify(r[0])); console.log('Last:', JSON.stringify(r[r.length-1]));"
   ```
   Expected: ~36 lessons, first should be unit 5 lesson 4 (Feb 9), last should be unit 9 lesson 5 (Apr 30).

5. **If any issues are found**, fix them directly in the affected file(s). Then re-run the checks.

## Constraints

- Only modify `scripts/lib/scan-calendars.mjs` and `scripts/menu.mjs`
- Do NOT modify any other files
- After fixes, re-run all checks to confirm
