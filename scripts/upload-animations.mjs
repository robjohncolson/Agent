#!/usr/bin/env node
/**
 * upload-animations.mjs — Upload rendered Manim MP4s to Supabase Storage
 *
 * Usage:
 *   node scripts/upload-animations.mjs --unit 7 --lesson 2
 *   node scripts/upload-animations.mjs --unit 6 --lesson 11 --retry-failed
 *   node scripts/upload-animations.mjs --unit 6 --lesson 11 --force
 *   node scripts/upload-animations.mjs --unit 6 --lesson 11 --dry-run
 *
 * Expects env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Uploads the best available render quality to:
 *   videos/animations/{cartridgeName}/{filename}.mp4
 */

import "dotenv/config";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import path from "path";
import { fetchWithRetry } from "./lib/fetch-retry.mjs";
import { CARTRIDGE_MAP } from "./lib/course-metadata.mjs";
import { loadState, saveState, updateFileState } from "./lib/upload-state.mjs";
import { emit } from "./lib/event-log.mjs";

// Corporate proxy TLS bypass
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

// ── Config ──────────────────────────────────────────────────────────────────

const DRILLER_DIR = "C:/Users/ColsonR/lrsl-driller";
const MEDIA_DIR = path.join(DRILLER_DIR, "media", "videos");
const BUCKET = "videos";
const QUALITY_PREFERENCE = ["720p30", "480p15", "1080p60"];

// ── Arg parsing ─────────────────────────────────────────────────────────────

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

// ── Find MP4s ───────────────────────────────────────────────────────────────

function findAnimationFiles(unit, lesson) {
  const prefix = `apstat_${unit}${lesson}`;
  if (!existsSync(MEDIA_DIR)) return [];

  return readdirSync(MEDIA_DIR)
    .filter(dir => dir.startsWith(prefix))
    .flatMap(dir => {
      for (const qualityLabel of QUALITY_PREFERENCE) {
        const qualityDir = path.join(MEDIA_DIR, dir, qualityLabel);
        if (!existsSync(qualityDir)) continue;

        const mp4s = readdirSync(qualityDir).filter(f => f.endsWith(".mp4"));
        if (mp4s.length === 0) continue;

        return mp4s.map(f => ({
          localPath: path.join(qualityDir, f),
          filename: f,
          qualityLabel,
          size: statSync(path.join(qualityDir, f)).size,
        }));
      }

      return [];
    });
}

// ── File selection planner ──────────────────────────────────────────────────

function planUploads(files, state, { force, retryFailed }) {
  return files.map(file => {
    const fileState = state.files[file.filename];
    if (force) return { ...file, action: 'upload' };
    if (retryFailed) {
      if (fileState?.status === 'failed') return { ...file, action: 'retry' };
      return { ...file, action: 'skip' };
    }
    if (fileState?.status === 'uploaded') return { ...file, action: 'skip' };
    return { ...file, action: 'upload' };
  });
}

// ── Idempotency probe ───────────────────────────────────────────────────────

async function checkExists(supabaseUrl, serviceKey, storagePath, expectedSize) {
  try {
    const url = `${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`;
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) return false;
    const contentLength = res.headers.get('content-length');
    if (contentLength && expectedSize && parseInt(contentLength, 10) !== expectedSize) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── Failure recording helper ─────────────────────────────────────────────────

function recordFailure(state, filename, errorMsg, { unit, lesson }) {
  updateFileState(state, filename, {
    status: 'failed', error: errorMsg, last_attempt: new Date().toISOString(),
    retries: (state.files[filename]?.retries || 0) + 1
  });
  emit('animation.upload.file', 'animation', {
    unit, lesson, filename, status: 'failed', error: errorMsg
  });
}

// ── Upload to Supabase (with retry) ─────────────────────────────────────────

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

// ── Main ────────────────────────────────────────────────────────────────────

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
    console.error("Add the mapping in scripts/lib/course-metadata.mjs.");
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

  emit('animation.upload.started', 'animation', {
    unit, lesson, total: files.length, toUpload: toUpload.length, toSkip: toSkip.length
  });

  if (dryRun) {
    plan.forEach(f => console.log(`  [${f.action}] ${f.filename}`));
    console.log('\n--dry-run: no files uploaded.');
    process.exit(0);
  }

  console.log(`  Bucket: ${BUCKET}`);
  console.log(`  Path prefix: animations/${cartridgeName}/\n`);

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
        updateFileState(state, file.filename, {
          status: 'uploaded', url: storagePath, skipped_at: new Date().toISOString()
        });
        skipped++;
        continue;
      }
    }

    process.stdout.write(`  ${file.filename} [${file.qualityLabel}] (${sizeKB} KB) → ${storagePath} ... `);

    try {
      const result = await uploadFile(supabaseUrl, serviceKey, storagePath, file.localPath);
      if (result.success) {
        console.log(`✓ (HTTP ${result.status})`);
        updateFileState(state, file.filename, {
          status: 'uploaded', url: storagePath, uploaded_at: new Date().toISOString(),
          size_bytes: file.size, retries: 0
        });
        emit('animation.upload.file', 'animation', {
          unit, lesson, filename: file.filename, status: 'uploaded', retries: 0
        });
        succeeded++;
      } else {
        const errorMsg = result.error;
        console.log(`✗ (HTTP ${result.status})`);
        console.log(`    Error: ${errorMsg}`);
        recordFailure(state, file.filename, errorMsg, { unit, lesson });
        failed++;
      }
    } catch (err) {
      console.log(`✗ (${err.message})`);
      recordFailure(state, file.filename, err.message, { unit, lesson });
      failed++;
    }
  }

  saveState(state);
  console.log(`\nDone. ${succeeded} uploaded, ${skipped} skipped, ${failed} failed.`);

  emit('animation.upload.completed', 'animation', {
    unit, lesson, succeeded, skipped, failed, total: files.length
  });

  if (failed > 0) process.exit(1);
}

main();
