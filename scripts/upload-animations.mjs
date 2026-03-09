#!/usr/bin/env node
/**
 * upload-animations.mjs — Upload rendered Manim MP4s to Supabase Storage
 *
 * Usage: node scripts/upload-animations.mjs --unit 7 --lesson 2
 *
 * Expects env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Uploads 720p30 renders to: videos/animations/{cartridgeName}/{filename}.mp4
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import path from "path";

// ── Config ──────────────────────────────────────────────────────────────────

const DRILLER_DIR = "C:/Users/ColsonR/lrsl-driller";
const MEDIA_DIR = path.join(DRILLER_DIR, "media", "videos");
const BUCKET = "videos";
const QUALITY = "720p30";

const CARTRIDGE_MAP = {
  "5": "apstats-u5-sampling-dist",
  "6": "apstats-u6-inference-prop",
  "7": "apstats-u7-mean-ci",
};

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let unit = null, lesson = null;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--unit" || args[i] === "-u") && args[i + 1]) unit = args[++i];
    if ((args[i] === "--lesson" || args[i] === "-l") && args[i + 1]) lesson = args[++i];
  }
  if (!unit || !lesson) {
    console.error("Usage: node scripts/upload-animations.mjs --unit <U> --lesson <L>");
    process.exit(1);
  }
  return { unit, lesson };
}

// ── Find MP4s ───────────────────────────────────────────────────────────────

function findAnimationFiles(unit, lesson) {
  const prefix = `apstat_${unit}${lesson}`;
  if (!existsSync(MEDIA_DIR)) return [];

  return readdirSync(MEDIA_DIR)
    .filter(dir => dir.startsWith(prefix))
    .flatMap(dir => {
      const qualityDir = path.join(MEDIA_DIR, dir, QUALITY);
      if (!existsSync(qualityDir)) return [];
      return readdirSync(qualityDir)
        .filter(f => f.endsWith(".mp4"))
        .map(f => ({
          localPath: path.join(qualityDir, f),
          filename: f,
          size: statSync(path.join(qualityDir, f)).size,
        }));
    });
}

// ── Upload to Supabase ──────────────────────────────────────────────────────

async function uploadFile(supabaseUrl, serviceKey, storagePath, localPath) {
  const fileData = readFileSync(localPath);
  const url = `${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`;

  // Try upsert (PUT first, then POST if bucket doesn't support upsert)
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "video/mp4",
      "x-upsert": "true",
    },
    body: fileData,
  });

  if (res.ok) return { success: true, status: res.status };

  // If PUT fails, try POST (create)
  if (res.status === 400 || res.status === 404) {
    const res2 = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "video/mp4",
      },
      body: fileData,
    });
    if (res2.ok) return { success: true, status: res2.status };
    const body = await res2.text();
    return { success: false, status: res2.status, error: body };
  }

  const body = await res.text();
  return { success: false, status: res.status, error: body };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { unit, lesson } = parseArgs();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }

  const cartridgeName = CARTRIDGE_MAP[String(unit)];
  if (!cartridgeName) {
    console.error(`Error: No cartridge mapping for unit ${unit}.`);
    console.error("Either add it to CARTRIDGE_MAP or pass --cartridge <id>.");
    process.exit(1);
  }

  const files = findAnimationFiles(unit, lesson);
  if (files.length === 0) {
    console.log(`No animation MP4s found for unit ${unit} lesson ${lesson}.`);
    process.exit(0);
  }

  console.log(`Uploading ${files.length} animation(s) to Supabase...`);
  console.log(`  Bucket: ${BUCKET}`);
  console.log(`  Path prefix: animations/${cartridgeName}/\n`);

  let succeeded = 0, failed = 0;

  for (const file of files) {
    const storagePath = `animations/${cartridgeName}/${file.filename}`;
    const sizeKB = Math.round(file.size / 1024);
    process.stdout.write(`  ${file.filename} (${sizeKB} KB) → ${storagePath} ... `);

    const result = await uploadFile(supabaseUrl, serviceKey, storagePath, file.localPath);
    if (result.success) {
      console.log(`✓ (HTTP ${result.status})`);
      succeeded++;
    } else {
      console.log(`✗ (HTTP ${result.status})`);
      console.log(`    Error: ${result.error}`);
      failed++;
    }
  }

  console.log(`\nDone. ${succeeded} uploaded, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
