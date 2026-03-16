#!/usr/bin/env node
/**
 * batch-upload-animations.mjs — Upload ALL rendered 720p30 Manim MP4s to Supabase Storage.
 *
 * Iterates through all lessons, finds 720p30 final mp4s, uploads to:
 *   videos/animations/{cartridgeName}/{filename}.mp4
 *
 * Usage:
 *   node scripts/batch-upload-animations.mjs              # upload all
 *   node scripts/batch-upload-animations.mjs --dry-run    # preview only
 *   node scripts/batch-upload-animations.mjs --force      # re-upload even if exists
 */

import "dotenv/config";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "fs";
import path from "path";
import { fetchWithRetry } from "./lib/fetch-retry.mjs";

process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= "0";

const DRILLER_DIR = "C:/Users/ColsonR/lrsl-driller";
const MEDIA_DIR = path.join(DRILLER_DIR, "media", "videos");
const BUCKET = "videos";
const QUALITY_LABEL = "720p30";

const CARTRIDGE_MAP = {
  "6": "apstats-u6-inference-prop",
  "7": "apstats-u7-mean-ci",
  "8": "apstats-u8-unexpected-results",
};

// Standalone animation dirs (not apstat_*) mapped to their cartridge
const STANDALONE_MAP = {
  conditional_probability_restriction: "apstatu4l1l2",
  conditional_from_tables: "apstatu4l1l2",
  general_multiplication_rule: "apstatu4l1l2",
  order_matters_conditional: "apstatu4l1l2",
  independent_vs_mutually_exclusive: "apstatu4l1l2",
  check_independence_multiplication: "apstatu4l1l2",
  indep_vs_mut_excl_compare: "apstatu4l1l2",
  probability_distribution_metrics: "apstatu4l1l2",
  mean_expected_value: "apstatu4l1l2",
  standard_deviation_formula: "apstatu4l1l2",
  bins_conditions_breakdown: "apstatu4l1l2",
  identify_binomial_setting: "apstatu4l1l2",
  binomial_formula_components: "apstatu4l1l2",
  calculate_binomial_probability: "apstatu4l1l2",
  cumulative_probability_summing: "apstatu4l1l2",
  binomial_capstone_review: "apstatu4l1l2",
  binomial_mean_sd_formulas: "apstatu4l1l2",
  binomial_standard_deviation: "apstatu4l1l2",
  interpret_binomial_params: "apstatu4l1l2",
  geometric_formula_parameters: "apstatu4l1l2",
  geometric_mean_sd: "apstatu4l1l2",
  geometric_vs_binomial_distinction: "apstatu4l1l2",
  binomial_geometric_capstone_synthesis: "apstatu4l1l2",
  two_sd_rule_unusual_outcomes: "apstatu4l1l2",
  variance_addition_trap: "apstatu4l1l2",
  addition_rule_venn_diagram: "apstatu4l1l2",
  sample_space_enumeration: "apstatu4l1l2",
  law_of_large_numbers: "apstatu4l1l2",
  random_selection_vs_assignment: "sampling",
  random_assignment_causation: "sampling",
  scope_of_inference_table: "sampling",
  simple_random_sample: "sampling",
  stratified_vs_cluster: "sampling",
  stratified_vs_cluster_tradeoffs: "sampling",
  cluster_sample_definition: "sampling",
  identify_sampling_method: "sampling",
  why_this_method: "sampling",
  choosing_sampling_method: "sampling",
  sampling_bias_types: "sampling",
  large_vs_representative: "sampling",
};

// Auto-discover lessons from animation directory names (apstat_<lesson>_*)
const LESSONS = (() => {
  if (!existsSync(MEDIA_DIR)) return [];
  const dirs = readdirSync(MEDIA_DIR).filter((d) => d.startsWith("apstat_"));
  const lessons = new Set();
  for (const d of dirs) {
    const m = d.match(/^apstat_(\d+)_/);
    if (m) lessons.add(m[1]);
  }
  return [...lessons].sort((a, b) => Number(a) - Number(b));
})();

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    force: args.includes("--force"),
    dryRun: args.includes("--dry-run"),
  };
}

function findAllMp4s() {
  const results = [];
  for (const lesson of LESSONS) {
    const unit = lesson.charAt(0);
    const prefix = `apstat_${lesson}_`;
    if (!existsSync(MEDIA_DIR)) continue;

    const dirs = readdirSync(MEDIA_DIR).filter((d) => d.startsWith(prefix));
    for (const dir of dirs) {
      const qualityDir = path.join(MEDIA_DIR, dir, QUALITY_LABEL);
      if (!existsSync(qualityDir)) continue;
      const mp4s = readdirSync(qualityDir).filter((f) => f.endsWith(".mp4"));
      for (const mp4 of mp4s) {
        const localPath = path.join(qualityDir, mp4);
        results.push({
          lesson,
          unit,
          filename: mp4,
          localPath,
          size: statSync(localPath).size,
          cartridge: CARTRIDGE_MAP[unit],
        });
      }
    }
  }
  // Also discover standalone animation directories
  if (existsSync(MEDIA_DIR)) {
    const allDirs = readdirSync(MEDIA_DIR).filter(
      (d) => !d.startsWith("apstat_") && STANDALONE_MAP[d]
    );
    for (const dir of allDirs) {
      const qualityDir = path.join(MEDIA_DIR, dir, QUALITY_LABEL);
      if (!existsSync(qualityDir)) continue;
      const mp4s = readdirSync(qualityDir).filter((f) => f.endsWith(".mp4"));
      for (const mp4 of mp4s) {
        const localPath = path.join(qualityDir, mp4);
        results.push({
          lesson: dir,
          unit: "standalone",
          filename: mp4,
          localPath,
          size: statSync(localPath).size,
          cartridge: STANDALONE_MAP[dir],
        });
      }
    }
  }

  return results;
}

async function checkExists(supabaseUrl, serviceKey, storagePath, expectedSize) {
  try {
    const url = `${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`;
    const res = await fetch(url, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) return false;
    const contentLength = res.headers.get("content-length");
    if (contentLength && expectedSize && parseInt(contentLength, 10) !== expectedSize) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function uploadFile(supabaseUrl, serviceKey, storagePath, localPath) {
  const fileData = readFileSync(localPath);
  const url = `${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`;

  const res = await fetchWithRetry(
    url,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "video/mp4",
        "x-upsert": "true",
      },
      body: fileData,
    },
    { maxRetries: 3, baseDelay: 1000 }
  );

  if (res.ok) return { success: true, status: res.status };
  const body = await res.text();
  return { success: false, status: res.status, error: body };
}

async function main() {
  const { force, dryRun } = parseArgs();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }

  const files = findAllMp4s();
  console.log(`Found ${files.length} MP4 files across ${LESSONS.length} lessons.\n`);

  if (dryRun) {
    for (const f of files) {
      const storagePath = `animations/${f.cartridge}/${f.filename}`;
      const sizeKB = Math.round(f.size / 1024);
      console.log(`  [dry-run] ${storagePath} (${sizeKB} KB)`);
    }
    console.log(`\n--dry-run: ${files.length} files would be uploaded.`);
    return;
  }

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  for (const f of files) {
    const storagePath = `animations/${f.cartridge}/${f.filename}`;
    const sizeKB = Math.round(f.size / 1024);

    if (!force) {
      const exists = await checkExists(supabaseUrl, serviceKey, storagePath, f.size);
      if (exists) {
        console.log(`  SKIP ${f.filename} (exists, ${sizeKB} KB)`);
        skipped++;
        continue;
      }
    }

    process.stdout.write(`  UPLOAD ${f.filename} (${sizeKB} KB) ... `);

    try {
      const result = await uploadFile(supabaseUrl, serviceKey, storagePath, f.localPath);
      if (result.success) {
        console.log(`OK (${result.status})`);
        uploaded++;
      } else {
        console.log(`FAIL (${result.status})`);
        console.log(`    ${result.error}`);
        failed++;
        failures.push({ file: f.filename, error: result.error });
      }
    } catch (err) {
      console.log(`FAIL (${err.message})`);
      failed++;
      failures.push({ file: f.filename, error: err.message });
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Total: ${files.length} | Uploaded: ${uploaded} | Skipped: ${skipped} | Failed: ${failed}`);

  // Save upload manifest
  const manifest = {
    timestamp: new Date().toISOString(),
    total: files.length,
    uploaded,
    skipped,
    failed,
    failures,
    files: files.map((f) => ({
      filename: f.filename,
      storagePath: `animations/${f.cartridge}/${f.filename}`,
      sizeBytes: f.size,
      lesson: f.lesson,
      unit: f.unit,
    })),
  };
  writeFileSync("state/animation-upload-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log("\nManifest saved to state/animation-upload-manifest.json");

  if (failed > 0) process.exit(1);
}

main();
