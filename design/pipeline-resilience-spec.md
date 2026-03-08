# Pipeline Resilience Spec — 6 Quick Fixes

**Status**: Approved
**Date**: 2026-03-08
**Affects**: `scripts/lesson-prep.mjs`, `scripts/post-to-schoology.mjs`, `scripts/lib/verify-supabase.mjs` (new)

## Overview

Six targeted fixes to the lesson-prep pipeline that address silent state loss, missing preflight checks, and absent post-pipeline verification.

---

## Fix 1: Persist Schoology folder URL

**File**: `scripts/post-to-schoology.mjs`
**Problem**: When a folder is created in Schoology via `createFolder()` + `extractFolderUrl()`, the resulting folder URL is used for posting links but never saved to the lesson registry. If the pipeline is re-run or needs to resume, the folder URL is lost.
**Fix**: After `extractFolderUrl()` succeeds, call `updateUrl(unit, lesson, "schoologyFolder", folderUrl)` to persist the URL in the registry.

## Fix 2: Update animation status in registry

**File**: `scripts/lesson-prep.mjs` (post-step4 orchestration)
**Problem**: Step 3 (render) and Step 4 (upload) run, but the `animations` status key is never updated in the registry. This breaks the `canResume()` logic — re-running the pipeline always re-renders and re-uploads.
**Fix**: After step 3 completes, call `updateStatus(unit, lesson, "animations", renderResult.success ? "done" : "failed")`. If step 4 (upload) also succeeds, update it again if needed. The registry already has the `animations` status key defined.

## Fix 3: .env preflight check

**File**: `scripts/lesson-prep.mjs` (early in `main()`)
**Problem**: Pipeline runs multiple steps before encountering a missing env var (e.g., `SUPABASE_URL` for step 4, Blooket credentials for step 5). By the time the error surfaces, steps 1-3 have already consumed time and API calls.
**Fix**: Add a preflight check at the top of `main()` that verifies critical env vars exist based on which steps are NOT being skipped. Warn (don't abort) if vars are missing, since some steps may still succeed.

**Env vars to check**:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — needed unless `--skip-upload`
- Blooket credentials (check for cookie file or env) — needed unless `--skip-blooket`
- CDP port reachability — needed unless `--skip-schoology`

## Fix 4: Supabase upload verification

**File**: `scripts/lib/verify-supabase.mjs` (new)
**Problem**: Step 4 uploads animations to Supabase, but never verifies they are publicly accessible. If the upload silently fails or the bucket config is wrong, Step 6 posts dead links to Schoology.
**Fix**: New module that takes a list of expected Supabase asset URLs and performs HTTP HEAD requests with a timeout. Returns `{ verified: [...], failed: [...] }`. Called from lesson-prep.mjs after step 4.

**Expected export**: `verifySupabaseAssets(urls: string[], options?: { timeout?: number })`

## Fix 5: --target-folder flag for post-to-schoology.mjs

**File**: `scripts/post-to-schoology.mjs`
**Problem**: If the pipeline created a Schoology folder in a previous run (Fix 1 persisted the URL), a re-run creates a duplicate folder instead of posting into the existing one.
**Fix**: Add `--target-folder <url>` flag. When provided, skip `createFolder()` and use the given URL as the materials page URL for posting. lesson-prep.mjs should check the registry for an existing `schoologyFolder` URL and pass it via `--target-folder` if present.

## Fix 6: noFiles detection in step 3/4

**File**: `scripts/lesson-prep.mjs` (step 3 + step 4 functions)
**Problem**: If Codex (step 2) produces a cartridge with no animations (e.g., a purely calculation-based mode), steps 3 and 4 still run and silently produce 0 files. The summary reports "0 succeeded, 0 failed" which looks like an error when it's actually expected.
**Fix**: Before calling step 3, check if any `.py` animation files exist for the target unit+lesson. If none exist, set a `noFiles` flag and skip steps 3 and 4 with a clear message: "No animation files for {unit}.{lesson} — skipping render and upload." Update registry status to `"skipped"` instead of leaving it as `"pending"`.
