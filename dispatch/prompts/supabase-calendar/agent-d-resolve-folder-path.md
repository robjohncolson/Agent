# Agent D: resolve-folder-path.mjs (Supabase-first lookup)

## Overview
Modify `scripts/lib/resolve-folder-path.mjs` to use Supabase as the primary data source for topic dates, with `topic-schedule.json` as an offline fallback.

## Target File
`scripts/lib/resolve-folder-path.mjs` — **MODIFY**

## Dependency
- Requires `scripts/lib/supabase-schedule.mjs` (Agent A) — imports `getSchedule`

## Current Priority Chain
```
explicit --date  →  topic-schedule.json (loadSchedule)  →  lesson-registry.json
```

## New Priority Chain
```
explicit --date  →  Supabase (getSchedule)  →  topic-schedule.json (loadSchedule)  →  lesson-registry.json
```

## Changes Required

### 1. Add import
```javascript
import { getSchedule } from './supabase-schedule.mjs';
```

### 2. Add Supabase schedule loader
Add a new function that wraps `getSchedule` and extracts just the date field:

```javascript
/**
 * Load topic dates from Supabase. Returns null on any failure (callers fall back to local JSON).
 * @param {string} period - "B" or "E"
 * @returns {Promise<Record<string, string>|null>} topic → ISO date, or null
 */
async function loadScheduleFromSupabase(period) {
  try {
    const schedule = await getSchedule(period);
    if (!schedule) return null;
    const result = {};
    for (const [topic, entry] of schedule) {
      result[topic] = entry.date;
    }
    return result;
  } catch {
    return null;
  }
}
```

### 3. Make `resolveFolderPath` async
Change the function signature from:
```javascript
export function resolveFolderPath(unit, lesson, options = {}) {
```
to:
```javascript
export async function resolveFolderPath(unit, lesson, options = {}) {
```

### 4. Insert Supabase lookup before local schedule
In the date resolution section (currently lines ~133-138), add the Supabase lookup between the explicit date check and the local schedule check:

```javascript
// Step 1: Resolve date (priority: explicit > Supabase > local schedule > registry).
let date = options.date || null;

if (!date) {
  const supabaseSchedule = await loadScheduleFromSupabase(period);
  if (supabaseSchedule) {
    date = supabaseSchedule[topicKey] || null;
  }
}

if (!date) {
  const schedule = loadSchedule(period);
  date = schedule[topicKey] || null;
}

if (!date) {
  date = loadRegistryDate(unit, lesson);
}
```

## CRITICAL: Do NOT change
- `determineSchoolWeek()` — leave it exactly as-is (exported, used by calendar.html port)
- `formatDayTitle()` — leave it exactly as-is
- `loadSchedule()` — keep as fallback (offline mode)
- `loadRegistryDate()` — keep as final fallback
- The return type and shape of `resolveFolderPath` — same object, just async now
- All existing exports must remain

## Callers — ALL must be updated to `await`

Making `resolveFolderPath` async means every call site becomes a Promise. You MUST update all of these (all are already in async contexts):

### `scripts/post-to-schoology.mjs` (2 call sites)
1. **Line ~607** (guard check):
   ```javascript
   // Before: resolveFolderPath(unit, lesson, { period: 'B' });
   // After:
   await resolveFolderPath(unit, lesson, { period: 'B' });
   ```
2. **Line ~655** (per-course resolution):
   ```javascript
   // Before: const folderInfo = resolveFolderPath(unit, lesson, { period: currentPeriod });
   // After:
   const folderInfo = await resolveFolderPath(unit, lesson, { period: currentPeriod });
   ```

### `scripts/lesson-prep.mjs` (2 call sites)
3. **Line ~1304** (legacy Schoology posting fallback):
   ```javascript
   // Before: const folderInfo = resolveFolderPath(unit, lesson);
   // After:
   const folderInfo = await resolveFolderPath(unit, lesson);
   ```
4. **Line ~1714** (task-runner context seeding fallback):
   ```javascript
   // Before: const folderInfo = resolveFolderPath(unit, lesson, {
   // After:
   const folderInfo = await resolveFolderPath(unit, lesson, {
   ```

### `scripts/verify-u6-drills.mjs` (2 call sites)
5. **Line ~141** (folder discovery):
   ```javascript
   // Before: const fpInfo = resolveFolderPath(6, n, { period: p });
   // After:
   const fpInfo = await resolveFolderPath(6, n, { period: p });
   ```
6. **Line ~280** (folder persistence in --fix mode):
   ```javascript
   // Before: const fpInfo = resolveFolderPath(6, n, { period: p });
   // After:
   const fpInfo = await resolveFolderPath(6, n, { period: p });
   ```

All 6 call sites are inside async functions wrapped in try/catch, so adding `await` is safe and non-breaking.

## Do NOT
- Do not rewrite the entire file — make surgical changes
- Do not remove the local `loadSchedule()` fallback
- Do not change the exports other than making `resolveFolderPath` async
- Do not skip any of the 6 caller updates — missing any one creates a Promise misuse bug
