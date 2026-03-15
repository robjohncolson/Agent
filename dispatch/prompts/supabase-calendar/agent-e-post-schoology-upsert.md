# Agent E: post-to-schoology.mjs (Upsert folder ID to Supabase)

## Overview
Modify `scripts/post-to-schoology.mjs` to write the Schoology folder ID back to the Supabase `topic_schedule` table after successfully creating or reusing a folder.

## Target File
`scripts/post-to-schoology.mjs` — **MODIFY**

## Dependency
- Requires `scripts/lib/supabase-schedule.mjs` (Agent A) — imports `upsertTopic`

## Changes Required

### 1. Add import (near the existing imports at top of file)
```javascript
import { upsertTopic } from './lib/supabase-schedule.mjs';
```

### 2. Add Supabase upsert helper
Add a small helper that wraps the upsert in try/catch (Supabase failure must NOT block Schoology posting):

```javascript
async function syncFolderToSupabase(unit, lesson, period, folderId) {
  try {
    const topicKey = `${unit}.${lesson}`;
    // NOTE: Only sends status + schoologyFolderId. The row MUST already exist
    // from the initial migration (sync-schedule-to-supabase.mjs --execute).
    // The table requires `date` NOT NULL, so this upsert will fail silently
    // (non-throwing) if the migration hasn't run yet — that's acceptable
    // because the try/catch prevents it from blocking Schoology posting.
    await upsertTopic(topicKey, period, {
      status: 'posted',
      schoologyFolderId: folderId,
    });
    console.log(`  [supabase] Synced folder ID ${folderId} for ${topicKey} Period ${period}`);
  } catch (err) {
    console.warn(`  [supabase] Failed to sync folder ID: ${err.message}`);
  }
}
```

### 3. Call after folder creation/reuse — THREE code paths

There are 3 code paths where a folder ID is determined. After each one, add the Supabase sync call.

#### Path 1: `--folder-path` with `--create-folder` (around line ~706-728)
After `updateUrl(unit, lesson, currentFolderUrlKey, materialsUrl);` and `setSchoologyState(...)`:
```javascript
// Sync folder ID to Supabase
const sbFolderId = folderIdMatch ? folderIdMatch[1] : null;
if (sbFolderId) await syncFolderToSupabase(unit, lesson, currentPeriod, sbFolderId);
```

#### Path 2: `--folder-path` without `--create-folder` (around line ~730-742)
After `setSchoologyState(...)`:
```javascript
const sbFolderId = folderIdMatch ? folderIdMatch[1] : null;
if (sbFolderId) await syncFolderToSupabase(unit, lesson, currentPeriod, sbFolderId);
```

#### Path 3: `--create-folder` at root level (around line ~750-781)
After `setSchoologyState(...)`:
```javascript
const sbFolderId = folderIdMatch ? folderIdMatch[1] : null;
if (sbFolderId) await syncFolderToSupabase(unit, lesson, currentPeriod, sbFolderId);
```

### 4. Handle `resolveFolderPath` becoming async
`resolveFolderPath` is now async (Agent D change). Two call sites in this file:

**Call site 1** — the guard check (around line ~607):
```javascript
// Current (sync):
resolveFolderPath(unit, lesson, { period: 'B' });

// Change to (async):
await resolveFolderPath(unit, lesson, { period: 'B' });
```

**Call site 2** — per-course folder resolution (around line ~655):
```javascript
// Current (sync):
const folderInfo = resolveFolderPath(unit, lesson, { period: currentPeriod });

// Change to (async):
const folderInfo = await resolveFolderPath(unit, lesson, { period: currentPeriod });
```

Both are already inside `async function main()`, so adding `await` is safe.

## CRITICAL: Do NOT
- Do not make Supabase errors block or abort Schoology posting — always wrap in try/catch
- Do not remove or change any existing registry writes (`updateUrl`, `setSchoologyState`, etc.)
- Do not change the overall posting logic — only add the Supabase sync calls
- Do not rewrite the entire file — make surgical insertions
