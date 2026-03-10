# Animation Upload Robustness Spec

## Goal
Make `scripts/upload-animations.mjs` resilient to transient Supabase fetch failures with retry logic, idempotency checks, per-file status tracking, and structured error reporting via `agent_events`.

## Problem
During lesson 6.11 pipeline run, 2/5 animation uploads failed with transient `fetch` errors to Supabase Storage. Currently:
- No retry logic — one failure = permanent skip
- No idempotency — re-running uploads all files again, even already-uploaded ones
- No per-file status — only registry-level "done" or not
- No event emission — failures are logged to console only

## Current Implementation
`scripts/upload-animations.mjs`:
- Finds rendered MP4 files in the Manim output directory
- Uploads each to Supabase Storage bucket via `fetch` (PUT)
- Updates `state/lesson-registry.json` with public URLs
- Called by `lesson-prep.mjs` Step 4 via `execSync`

## Changes

### 1. Retry with Exponential Backoff
Add a `fetchWithRetry` wrapper:
```javascript
async function fetchWithRetry(url, options, { maxRetries = 3, baseDelay = 1000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500) return res;
      // Server error — retry
    } catch (err) {
      if (attempt === maxRetries) throw err;
    }
    const delay = baseDelay * Math.pow(2, attempt);
    await new Promise(r => setTimeout(r, delay));
  }
}
```
- Retry on: network errors, 5xx responses
- Don't retry on: 4xx (auth, bad request)
- Max 3 retries, backoff: 1s → 2s → 4s

### 2. Idempotency Check
Before uploading each file:
- Check if the file already exists in Supabase Storage (HEAD request or list bucket)
- Compare file size / hash if present
- Skip upload if identical file exists
- Log: "Skipping {filename} — already uploaded"

### 3. Per-File Status Tracking
Add `state/animation-uploads.json`:
```json
{
  "unit": 6,
  "lesson": 11,
  "files": {
    "anim_sampling_dist.mp4": {
      "status": "uploaded",
      "url": "https://...",
      "uploaded_at": "2026-03-10T...",
      "size_bytes": 1234567,
      "retries": 0
    },
    "anim_clt_demo.mp4": {
      "status": "failed",
      "error": "fetch failed: ECONNRESET",
      "last_attempt": "2026-03-10T...",
      "retries": 3
    }
  }
}
```
- On re-run, only attempt files with status !== "uploaded"
- `--force` flag resets all statuses and re-uploads everything

### 4. Event Emission
Emit structured events to `agent_events` via `event-log.mjs`:
- `animation_upload_start` — with file count
- `animation_upload_file` — per file: filename, status, url, retries, error
- `animation_upload_end` — summary: total, uploaded, failed, skipped

### 5. CLI Flags
- `--unit <N>` / `--lesson <N>` — target lesson (existing)
- `--force` — ignore idempotency, re-upload all
- `--dry-run` — list files that would be uploaded, don't actually upload
- `--retry-failed` — only retry files with status `failed` in state file

## Implementation Order
1. `fetchWithRetry` utility function (can go in `scripts/lib/fetch-retry.mjs`)
2. Per-file state tracking in `state/animation-uploads.json`
3. Idempotency check (HEAD request before upload)
4. Wire retry into main upload loop
5. Event emission via `event-log.mjs`
6. CLI flags (`--force`, `--dry-run`, `--retry-failed`)
7. Update `tasks/upload-animations.json` to reflect new capabilities

## Files Changed
- Modified: `scripts/upload-animations.mjs` (main changes)
- New: `scripts/lib/fetch-retry.mjs` (retry utility)
- Modified: `state/animation-uploads.json` (per-file tracking — created at runtime)
- Modified: `tasks/upload-animations.json` (updated inputs for new flags)

## Testing
- `node scripts/upload-animations.mjs --unit 6 --lesson 11 --dry-run` — should list files without uploading
- `node scripts/upload-animations.mjs --unit 6 --lesson 11 --retry-failed` — should retry only failed files from 6.11
- `node scripts/upload-animations.mjs --unit 6 --lesson 11 --force` — should re-upload everything
