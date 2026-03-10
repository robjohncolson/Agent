# Animation Upload Robustness Implementation Prompts

Organized by wave from `design/animation-robustness-dep-graph.md`. Each prompt is self-contained for a Codex agent.

## Wave 1 (parallel: 1A + 1B + 1C)

### Wave 1A: Fetch Retry Utility

````text
Repo root: C:\Users\ColsonR\Agent

Create file: `scripts/lib/fetch-retry.mjs`

```javascript
/**
 * fetch-retry.mjs — fetch wrapper with exponential backoff.
 * Retries on network errors and 5xx responses. Does NOT retry 4xx.
 */

/**
 * @param {string} url
 * @param {RequestInit} options
 * @param {{ maxRetries?: number, baseDelay?: number }} retryOpts
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, { maxRetries = 3, baseDelay = 1000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      // Success or client error (4xx) — don't retry
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      // Server error (5xx) — retry
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      // Network error — retry
      lastError = err;
    }
    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}
```

Create only this one file. Do not modify any other files.
````

### Wave 1B: Per-File Upload State Helpers

````text
Repo root: C:\Users\ColsonR\Agent

This is a code snippet to add to `scripts/upload-animations.mjs` later (Wave 3).
For now, create a helper module at `scripts/lib/upload-state.mjs`:

```javascript
/**
 * upload-state.mjs — Per-file upload state persistence.
 * Tracks upload status for each animation file in state/animation-uploads.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const STATE_PATH = 'state/animation-uploads.json';

/** Load state for a unit+lesson. Returns { unit, lesson, files: {} } */
export function loadState(unit, lesson) {
  if (!existsSync(STATE_PATH)) return { unit, lesson, files: {} };
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    if (String(raw.unit) === String(unit) && String(raw.lesson) === String(lesson)) {
      return raw;
    }
    // Different lesson — start fresh
    return { unit, lesson, files: {} };
  } catch {
    return { unit, lesson, files: {} };
  }
}

/** Save state to disk */
export function saveState(state) {
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

/** Update a single file entry in state */
export function updateFileState(state, filename, update) {
  state.files[filename] = { ...(state.files[filename] || {}), ...update };
  saveState(state);
}
```

Create only this one file. Do not modify any other files.
````

### Wave 1C: Extended CLI Parsing

````text
Repo root: C:\Users\ColsonR\Agent

Read `scripts/upload-animations.mjs`. Modify the `parseArgs()` function to support three new flags while preserving existing `--unit`/`--lesson`:

Replace the existing `parseArgs()` function (lines 29-41) with:

```javascript
function parseArgs() {
  const args = process.argv.slice(2);
  let unit = null, lesson = null;
  let force = false, dryRun = false, retryFailed = false;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--unit" || args[i] === "-u") && args[i + 1]) unit = args[++i];
    else if ((args[i] === "--lesson" || args[i] === "-l") && args[i + 1]) lesson = args[++i];
    else if (args[i] === "--force") force = true;
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--retry-failed") retryFailed = true;
  }
  if (!unit || !lesson) {
    console.error("Usage: node scripts/upload-animations.mjs --unit <U> --lesson <L> [--force] [--dry-run] [--retry-failed]");
    process.exit(1);
  }
  return { unit, lesson, force, dryRun, retryFailed };
}
```

Modify only the `parseArgs()` function. Do not change any other code in this wave.
````

## Wave 2 (parallel: 2A + 2B)

### Wave 2A: File Selection Planner

````text
Repo root: C:\Users\ColsonR\Agent

Add a `planUploads()` function to `scripts/upload-animations.mjs` (insert after the `findAnimationFiles` function, before `uploadFile`):

```javascript
/**
 * Decide which files to upload based on state and CLI flags.
 * @returns {Array<{ filename, localPath, size, action: 'upload'|'skip'|'retry' }>}
 */
function planUploads(files, state, { force, retryFailed }) {
  return files.map(file => {
    const fileState = state.files[file.filename];

    // Force mode: upload everything
    if (force) return { ...file, action: 'upload' };

    // Retry-failed mode: only retry files that previously failed
    if (retryFailed) {
      if (fileState?.status === 'failed') return { ...file, action: 'retry' };
      return { ...file, action: 'skip' };
    }

    // Default mode: skip already-uploaded files
    if (fileState?.status === 'uploaded') return { ...file, action: 'skip' };
    return { ...file, action: 'upload' };
  });
}
```

Add only this function. Do not modify any other code in this wave.
````

### Wave 2B: Supabase Idempotency Probe

````text
Repo root: C:\Users\ColsonR\Agent

Add a `checkExists()` function to `scripts/upload-animations.mjs` (insert after the `planUploads` function):

```javascript
/**
 * Check if a file already exists in Supabase Storage via HEAD request.
 * Returns true if identical file exists, false otherwise.
 */
async function checkExists(supabaseUrl, serviceKey, storagePath, expectedSize) {
  try {
    const url = `${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`;
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
      },
    });
    if (!res.ok) return false;
    // Compare content-length if available
    const contentLength = res.headers.get('content-length');
    if (contentLength && expectedSize && parseInt(contentLength, 10) !== expectedSize) {
      return false; // Size mismatch — needs re-upload
    }
    return true;
  } catch {
    return false; // Network error — assume not exists
  }
}
```

Add only this function. Do not modify any other code in this wave.
````

## Wave 3: Integration — Rework Main Upload Loop

````text
Repo root: C:\Users\ColsonR\Agent

Read the current `scripts/upload-animations.mjs` in its entirety. Rewrite the `main()` function (lines 104-153) to integrate all the new pieces:

1. Import at the top of the file:
   ```javascript
   import { fetchWithRetry } from './lib/fetch-retry.mjs';
   import { loadState, saveState, updateFileState } from './lib/upload-state.mjs';
   ```

2. Replace the `uploadFile` function to use `fetchWithRetry`:
   ```javascript
   async function uploadFile(supabaseUrl, serviceKey, storagePath, localPath) {
     const fileData = readFileSync(localPath);
     const url = `${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`;
     const res = await fetchWithRetry(url, {
       method: "PUT",
       headers: {
         Authorization: `Bearer ${serviceKey}`,
         "Content-Type": "video/mp4",
         "x-upsert": "true",
       },
       body: fileData,
     }, { maxRetries: 3, baseDelay: 1000 });

     if (res.ok) return { success: true, status: res.status };
     const body = await res.text();
     return { success: false, status: res.status, error: body };
   }
   ```

3. Replace `main()`:
   ```javascript
   async function main() {
     const { unit, lesson, force, dryRun, retryFailed } = parseArgs();
     const supabaseUrl = process.env.SUPABASE_URL;
     const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

     if (!supabaseUrl || !serviceKey) {
       console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
       process.exit(1);
     }

     const cartridgeName = CARTRIDGE_MAP[String(unit)];
     if (!cartridgeName) {
       console.error(`Error: No cartridge mapping for unit ${unit}.`);
       process.exit(1);
     }

     const files = findAnimationFiles(unit, lesson);
     if (files.length === 0) {
       console.log(`No animation MP4s found for unit ${unit} lesson ${lesson}.`);
       process.exit(0);
     }

     const state = loadState(unit, lesson);
     const plan = planUploads(files, state, { force, retryFailed });

     const toUpload = plan.filter(f => f.action !== 'skip');
     const toSkip = plan.filter(f => f.action === 'skip');

     console.log(`Plan: ${toUpload.length} to upload, ${toSkip.length} to skip (of ${files.length} total)`);

     if (dryRun) {
       plan.forEach(f => console.log(`  [${f.action}] ${f.filename}`));
       console.log('\n--dry-run: no files uploaded.');
       process.exit(0);
     }

     let succeeded = 0, failed = 0, skipped = toSkip.length;

     for (const file of plan) {
       if (file.action === 'skip') {
         console.log(`  SKIP ${file.filename} (already uploaded)`);
         continue;
       }

       const storagePath = `animations/${cartridgeName}/${file.filename}`;
       const sizeKB = Math.round(file.size / 1024);

       // Idempotency check (unless --force)
       if (!force) {
         const exists = await checkExists(supabaseUrl, serviceKey, storagePath, file.size);
         if (exists) {
           console.log(`  SKIP ${file.filename} (exists in Supabase, ${sizeKB} KB)`);
           updateFileState(state, file.filename, { status: 'uploaded', url: storagePath, skipped_at: new Date().toISOString() });
           skipped++;
           continue;
         }
       }

       process.stdout.write(`  ${file.filename} (${sizeKB} KB) → ${storagePath} ... `);

       try {
         const result = await uploadFile(supabaseUrl, serviceKey, storagePath, file.localPath);
         if (result.success) {
           console.log(`✓ (HTTP ${result.status})`);
           updateFileState(state, file.filename, {
             status: 'uploaded', url: storagePath, uploaded_at: new Date().toISOString(),
             size_bytes: file.size, retries: 0
           });
           succeeded++;
         } else {
           console.log(`✗ (HTTP ${result.status})`);
           console.log(`    Error: ${result.error}`);
           updateFileState(state, file.filename, {
             status: 'failed', error: result.error, last_attempt: new Date().toISOString(),
             retries: (state.files[file.filename]?.retries || 0) + 1
           });
           failed++;
         }
       } catch (err) {
         console.log(`✗ (${err.message})`);
         updateFileState(state, file.filename, {
           status: 'failed', error: err.message, last_attempt: new Date().toISOString(),
           retries: (state.files[file.filename]?.retries || 0) + 1
         });
         failed++;
       }
     }

     console.log(`\nDone. ${succeeded} uploaded, ${skipped} skipped, ${failed} failed.`);
     if (failed > 0) process.exit(1);
   }
   ```

This is the main integration wave. Modify `scripts/upload-animations.mjs` as described.
````

## Wave 4 (parallel: 4A + 4B)

### Wave 4A: Event Emission

````text
Repo root: C:\Users\ColsonR\Agent

Add event emission to `scripts/upload-animations.mjs`. Import at the top:

```javascript
import { emit } from './lib/event-log.mjs';
```

Add these calls inside `main()`:

1. After the plan is computed (before the upload loop):
   ```javascript
   emit('animation.upload.started', 'animation', {
     unit, lesson, total: files.length, toUpload: toUpload.length, toSkip: toSkip.length
   });
   ```

2. After each successful upload (inside the `if (result.success)` block):
   ```javascript
   emit('animation.upload.file', 'animation', {
     unit, lesson, filename: file.filename, status: 'uploaded', retries: 0
   });
   ```

3. After each failed upload:
   ```javascript
   emit('animation.upload.file', 'animation', {
     unit, lesson, filename: file.filename, status: 'failed', error: result?.error || err?.message
   });
   ```

4. After the summary line at the end:
   ```javascript
   emit('animation.upload.completed', 'animation', {
     unit, lesson, succeeded, skipped, failed, total: files.length
   });
   ```

Modify only the event emission points. Do not change any upload logic.
````

### Wave 4B: Update Task Definition

````text
Repo root: C:\Users\ColsonR\Agent

Create or update file: `tasks/upload-animations.json`

```json
{
  "$schema": "../schema/task.schema.json",
  "id": "upload-animations",
  "name": "Upload rendered animations to Supabase",
  "type": "node-script",
  "worker": "scripts/upload-animations.mjs",
  "inputs": {
    "unit": "{{unit}}",
    "lesson": "{{lesson}}",
    "force": false,
    "retry_failed": false
  },
  "outputs": {
    "registry_key": "animation_urls"
  },
  "preconditions": {
    "registry_status": { "key": "animation_urls", "not": "done" }
  },
  "on_failure": {
    "strategy": "skip"
  },
  "timeout_minutes": 10
}
```

Create/overwrite this one file. Do not modify any other files.
````

## Wave 5: Validation

````text
Repo root: C:\Users\ColsonR\Agent

Run these commands to validate the implementation:

1. `node scripts/upload-animations.mjs --unit 6 --lesson 11 --dry-run`
   Expected: lists files with [upload] or [skip] actions, exits without uploading

2. `node scripts/upload-animations.mjs --unit 6 --lesson 11 --retry-failed`
   Expected: only retries files with status=failed in state/animation-uploads.json

3. Verify state/animation-uploads.json exists and has per-file entries

4. Verify tasks/upload-animations.json validates against schema/task.schema.json

Do not modify any files in this wave.
````
