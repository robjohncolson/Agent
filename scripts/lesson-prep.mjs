#!/usr/bin/env node
/**
 * lesson-prep.mjs — Orchestrates the full lesson-prep pipeline (v3).
 *
 * Usage:
 *   node scripts/lesson-prep.mjs --auto
 *   node scripts/lesson-prep.mjs --unit 6 --lesson 5 --drive-ids "ID1" "ID2"
 *
 * Pipeline (9 steps):
 *   Step 0:   whats-tomorrow.mjs          (if --auto)
 *   Step 0.5: Drive video lookup           (if --auto and no --drive-ids)
 *   Step 1:   aistudio-ingest.mjs via CDP  (interactive — user picks Drive files)
 *   Step 2:   Parallel codex --full-auto   (worksheet + cartridge)
 *   Step 3:   render-animations.mjs
 *   Step 4:   upload-animations.mjs        (Supabase)
 *   Step 5:   upload-blooket.mjs           (get Blooket URL)
 *   Step 6:   post-to-schoology.mjs        (--auto-urls --blooket <url>)
 *   Step 7:   lesson-urls.mjs              (print + clipboard)
 *   Step 8:   Print summary
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

// ── Script paths ─────────────────────────────────────────────────────────────
const SCRIPTS = {
  whatsTomorrow: "C:/Users/ColsonR/Agent/scripts/whats-tomorrow.mjs",
  aistudioIngest: "C:/Users/ColsonR/Agent/scripts/aistudio-ingest.mjs",
  renderAnimations: "C:/Users/ColsonR/Agent/scripts/render-animations.mjs",
  uploadAnimations: "C:/Users/ColsonR/lrsl-driller/scripts/upload-animations.mjs",
  uploadBlooket: "C:/Users/ColsonR/Agent/scripts/upload-blooket.mjs",
  postSchoology: "C:/Users/ColsonR/Agent/scripts/post-to-schoology.mjs",
  indexDriveVideos: "C:/Users/ColsonR/Agent/scripts/index-drive-videos.mjs",
  lessonUrls: "C:/Users/ColsonR/Agent/scripts/lesson-urls.mjs",
};

const WORKING_DIRS = {
  worksheet: "C:/Users/ColsonR/apstats-live-worksheet",
  driller: "C:/Users/ColsonR/lrsl-driller",
};

const DRIVE_VIDEO_INDEX_PATH = "C:/Users/ColsonR/Agent/config/drive-video-index.json";

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let unit = null;
  let lesson = null;
  const driveIds = [];
  let auto = false;
  let skipIngest = false;
  let skipRender = false;
  let skipUpload = false;
  let skipBlooket = false;
  let skipSchoology = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--auto") {
      auto = true;
    } else if (arg === "--skip-ingest") {
      skipIngest = true;
    } else if (arg === "--skip-render") {
      skipRender = true;
    } else if (arg === "--skip-upload") {
      skipUpload = true;
    } else if (arg === "--skip-blooket") {
      skipBlooket = true;
    } else if (arg === "--skip-schoology") {
      skipSchoology = true;
    } else if ((arg === "--unit" || arg === "-u") && args[i + 1]) {
      unit = parseInt(args[++i], 10);
    } else if ((arg === "--lesson" || arg === "-l") && args[i + 1]) {
      lesson = parseInt(args[++i], 10);
    } else if (arg === "--drive-ids") {
      // Collect all subsequent args until the next flag or end of args
      i++;
      while (i < args.length && !args[i].startsWith("-")) {
        driveIds.push(args[i]);
        i++;
      }
      i--; // back up so the for-loop increment lands correctly
    }
  }

  if (!auto && (!unit || !lesson)) {
    console.error(
      "Usage: node scripts/lesson-prep.mjs --unit <U> --lesson <L> [--drive-ids <ID>...]\n" +
        "       node scripts/lesson-prep.mjs --auto\n\n" +
        "Options:\n" +
        "  -u, --unit          Unit number  (required unless --auto)\n" +
        "  -l, --lesson        Lesson number (required unless --auto)\n" +
        "  --drive-ids         Space-separated Google Drive file IDs\n" +
        "  --auto              Detect unit+lesson from whats-tomorrow.mjs, auto-lookup Drive IDs\n" +
        "  --skip-ingest       Skip Step 1 (video context files already exist)\n" +
        "  --skip-render       Skip Step 3 (Manim rendering)\n" +
        "  --skip-upload       Skip Step 4 (Supabase animation upload)\n" +
        "  --skip-blooket      Skip Step 5 (Blooket upload)\n" +
        "  --skip-schoology    Skip Step 6 (Schoology posting)"
    );
    process.exit(1);
  }

  return { unit, lesson, driveIds, auto, skipIngest, skipRender, skipUpload, skipBlooket, skipSchoology };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if a script file exists. Returns true/false.
 */
function scriptExists(path) {
  return existsSync(path);
}

/**
 * Prompt the user interactively for input.
 */
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Step 0: Auto-detect from tomorrow's calendar ─────────────────────────────

function step0_detectTomorrow() {
  if (!scriptExists(SCRIPTS.whatsTomorrow)) {
    console.error("Error: whats-tomorrow.mjs not found. Cannot use --auto.");
    process.exit(1);
  }

  console.log("=== Step 0: Auto-detecting tomorrow's topic ===\n");

  let output;
  try {
    output = execSync(`node "${SCRIPTS.whatsTomorrow}"`, { encoding: "utf-8" });
  } catch (e) {
    console.error("whats-tomorrow.mjs failed:", e.message);
    process.exit(1);
  }

  // Print the calendar output for the user
  process.stdout.write(output);
  console.log();

  // Extract unit.lesson from topic lines like "Topic: 6.4 — ..."
  const topicMatch = output.match(/Topic:\s+(\d+)\.(\d+)/);
  if (!topicMatch) {
    console.error(
      "Could not auto-detect unit and lesson from tomorrow's calendar.\n" +
        "Please specify --unit and --lesson explicitly."
    );
    process.exit(1);
  }

  const unit = parseInt(topicMatch[1], 10);
  const lesson = parseInt(topicMatch[2], 10);
  console.log(`Detected: Unit ${unit}, Lesson ${lesson}\n`);
  return { unit, lesson };
}

// ── Step 0.5: Drive video lookup ─────────────────────────────────────────────

async function step05_driveVideoLookup(unit, lesson, opts) {
  const topic = `${unit}.${lesson}`;

  console.log(`=== Step 0.5: Looking up Drive video IDs for Topic ${topic} ===\n`);

  // Try the index file first
  if (existsSync(DRIVE_VIDEO_INDEX_PATH)) {
    try {
      const index = JSON.parse(readFileSync(DRIVE_VIDEO_INDEX_PATH, "utf-8"));
      const matches = (index.videos || []).filter((v) => v.topic === topic);

      if (matches.length > 0) {
        const ids = matches
          .sort((a, b) => (a.video_number || 0) - (b.video_number || 0))
          .map((v) => v.file_id);
        console.log(`Found ${matches.length} video(s) for Topic ${topic} in Drive index.`);
        for (const m of matches) {
          console.log(`  Video ${m.video_number || "?"}: ${m.filename} (${m.file_id})`);
        }
        console.log();
        return ids;
      } else {
        console.log(`No videos for Topic ${topic} in Drive index.`);
      }
    } catch (e) {
      console.log(`Could not read Drive index: ${e.message}`);
    }
  } else {
    console.log(`Drive index not found at ${DRIVE_VIDEO_INDEX_PATH}.`);
    console.log(`Run: node scripts/index-drive-videos.mjs --folder <URL>  to build it.\n`);
  }

  // Fallback: prompt the user for Drive IDs interactively
  const input = await ask(
    "Enter Google Drive file IDs for the video(s), separated by spaces:\nDrive ID(s): "
  );
  if (input) {
    const ids = input.split(/\s+/).filter(Boolean);
    if (ids.length > 0) {
      console.log(`Using ${ids.length} manually-entered Drive ID(s).\n`);
      return ids;
    }
  }

  console.log("No Drive IDs provided.\n");
  return [];
}

// ── Step 1: CDP video ingest ─────────────────────────────────────────────────

function step1_videoIngest(unit, lesson, driveIds) {
  if (!scriptExists(SCRIPTS.aistudioIngest)) {
    console.error("Error: aistudio-ingest.mjs not found.");
    process.exit(1);
  }

  console.log(`=== Step 1: Video ingest via CDP (${driveIds.length} video(s)) ===\n`);

  try {
    execSync(
      `node "${SCRIPTS.aistudioIngest}" --unit ${unit} --lesson ${lesson} --drive-ids ${driveIds.join(" ")}`,
      { stdio: "inherit" }
    );
    console.log("\nVideo ingest complete.\n");
  } catch (e) {
    console.error(`\nVideo ingest failed: ${e.message}`);
    console.error("Continuing with remaining pipeline steps...\n");
  }
}

// ── Step 2: Parallel content generation ──────────────────────────────────────

function launchCodexSession(label, prompt, workingDir) {
  return new Promise((resolve) => {
    console.log(`  Starting ${label}...`);

    const proc = spawn(
      "codex",
      ["--full-auto", prompt],
      {
        stdio: "inherit",
        shell: true,
        cwd: workingDir,
      }
    );

    proc.on("error", (err) => {
      console.error(`  ${label} failed to start: ${err.message}`);
      resolve({ label, success: false, error: err.message });
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`  ${label} completed successfully.`);
        resolve({ label, success: true });
      } else {
        console.error(`  ${label} exited with code ${code}.`);
        resolve({ label, success: false, error: `exit code ${code}` });
      }
    });
  });
}

async function step2_contentGeneration(unit, lesson) {
  console.log("=== Step 2: Parallel content generation (Codex) ===\n");

  const worksheetPrompt =
    `Generate a follow-along worksheet, AI grading prompts, and Blooket CSV for Topic ${unit}.${lesson}. ` +
    `Read the video context files in u${unit}/ for the lesson content. ` +
    `Follow the patterns established by existing worksheets.`;

  const drillerPrompt =
    `Extend the apstats-u6-inference-prop cartridge with Topic ${unit}.${lesson} modes and generate Manim animations. ` +
    `Read existing modes in manifest.json for the pattern. ` +
    `Add new modes, generator logic, grading rules, and animation .py files.`;

  const session1 = launchCodexSession(
    "Worksheet + Grading + Blooket",
    worksheetPrompt,
    WORKING_DIRS.worksheet
  );

  const session2 = launchCodexSession(
    "Cartridge + Animations",
    drillerPrompt,
    WORKING_DIRS.driller
  );

  const results = await Promise.all([session1, session2]);
  console.log();

  for (const r of results) {
    const status = r.success ? "OK" : `FAILED (${r.error})`;
    console.log(`  ${r.label}: ${status}`);
  }
  console.log();

  return results;
}

// ── Step 3: Render Manim animations ──────────────────────────────────────────

function step3_renderAnimations(unit, lesson) {
  if (!scriptExists(SCRIPTS.renderAnimations)) {
    console.error("Error: render-animations.mjs not found.");
    process.exit(1);
  }

  console.log("=== Step 3: Rendering Manim animations ===\n");

  try {
    execSync(
      `node "${SCRIPTS.renderAnimations}" --unit ${unit} --lesson ${lesson}`,
      { stdio: "inherit" }
    );
    console.log();
  } catch (e) {
    console.error(`\nrender-animations.mjs failed: ${e.message}`);
    console.error("Continuing with remaining pipeline steps...\n");
  }
}

// ── Step 4: Upload animations to Supabase ────────────────────────────────────

function step4_uploadAnimations(unit, lesson) {
  if (!scriptExists(SCRIPTS.uploadAnimations)) {
    console.log("upload-animations.mjs not found, skipping upload.\n");
    return;
  }

  console.log("=== Step 4: Uploading animations to Supabase ===\n");

  try {
    execSync(
      `node "${SCRIPTS.uploadAnimations}" --unit ${unit} --lesson ${lesson}`,
      { stdio: "inherit", cwd: WORKING_DIRS.driller }
    );
    console.log();
  } catch (e) {
    console.log("Supabase upload skipped (no credentials or upload failed).\n");
  }
}

// ── Step 5: Upload Blooket ───────────────────────────────────────────────────

function step5_uploadBlooket(unit, lesson) {
  if (!scriptExists(SCRIPTS.uploadBlooket)) {
    console.log("upload-blooket.mjs not found, skipping Blooket upload.\n");
    return null;
  }

  console.log("=== Step 5: Uploading Blooket set ===\n");

  let blooketUrl = null;
  try {
    const output = execSync(
      `node "${SCRIPTS.uploadBlooket}" --unit ${unit} --lesson ${lesson}`,
      { encoding: "utf-8", timeout: 120000 }
    );
    // Print the output so the user can see progress
    process.stdout.write(output);

    // Extract the Blooket URL from output
    const match = output.match(/https:\/\/dashboard\.blooket\.com\/set\/[a-z0-9]+/i);
    if (match) {
      blooketUrl = match[0];
      console.log(`\nBlooket URL captured: ${blooketUrl}\n`);
    } else {
      console.log("\nBlooket upload completed but could not extract URL from output.\n");
    }
  } catch (e) {
    console.log(`Blooket upload failed: ${e.message}`);
    console.log("Continuing with remaining pipeline steps...\n");
  }

  return blooketUrl;
}

// ── Step 6: Post to Schoology ────────────────────────────────────────────────

function step6_postToSchoology(unit, lesson, blooketUrl) {
  if (!scriptExists(SCRIPTS.postSchoology)) {
    console.log("post-to-schoology.mjs not found, skipping Schoology posting.\n");
    return;
  }

  console.log("=== Step 6: Posting links to Schoology ===\n");

  const blooketArg = blooketUrl ? ` --blooket "${blooketUrl}"` : "";

  try {
    execSync(
      `node "${SCRIPTS.postSchoology}" --unit ${unit} --lesson ${lesson} --auto-urls${blooketArg}`,
      { stdio: "inherit", timeout: 180000 }
    );
    console.log();
  } catch (e) {
    console.error(`Schoology posting failed: ${e.message}`);
    console.error("Continuing with remaining pipeline steps...\n");
  }
}

// ── Step 7: Generate lesson URLs ─────────────────────────────────────────────

function step7_lessonUrls(unit, lesson) {
  if (!scriptExists(SCRIPTS.lessonUrls)) {
    console.log("lesson-urls.mjs not found, skipping URL assembly.\n");
    return;
  }

  console.log("=== Step 7: Generating lesson URLs ===\n");

  try {
    execSync(
      `node "${SCRIPTS.lessonUrls}" --unit ${unit} --lesson ${lesson}`,
      { stdio: "inherit" }
    );
    console.log();
  } catch (e) {
    console.error(`lesson-urls.mjs failed: ${e.message}\n`);
  }
}

// ── Step 8: Print summary ────────────────────────────────────────────────────

function step8_summary(unit, lesson, results) {
  console.log("=== Step 8: Pipeline Summary ===\n");

  const completed = [];
  const skipped = [];
  const failed = [];
  const manual = [];

  // Step 0
  if (results.autoDetected) {
    completed.push(`Step 0: Auto-detected Unit ${unit}, Lesson ${lesson}`);
  }

  // Step 0.5
  if (results.driveIdsSource === "index") {
    completed.push(`Step 0.5: Drive IDs from index (${results.driveIdCount} video(s))`);
  } else if (results.driveIdsSource === "manual") {
    completed.push(`Step 0.5: Drive IDs entered manually (${results.driveIdCount} video(s))`);
  } else if (results.driveIdsSource === "args") {
    completed.push(`Step 0.5: Drive IDs from --drive-ids (${results.driveIdCount} video(s))`);
  } else if (results.driveIdsSource === "none") {
    skipped.push("Step 0.5: No Drive IDs (ingest skipped)");
  }

  // Step 1
  if (results.skipIngest) {
    skipped.push("Step 1: Video ingest (--skip-ingest)");
  } else if (results.driveIdCount === 0) {
    skipped.push("Step 1: Video ingest (no Drive IDs)");
  } else {
    completed.push("Step 1: Video ingest via CDP");
  }

  // Step 2
  if (results.codexResults) {
    for (const r of results.codexResults) {
      if (r.success) {
        completed.push(`Step 2: ${r.label}`);
      } else {
        failed.push(`Step 2: ${r.label} (${r.error})`);
      }
    }
  }

  // Step 3
  if (results.skipRender) {
    skipped.push("Step 3: Manim rendering (--skip-render)");
  } else {
    completed.push("Step 3: Manim rendering");
  }

  // Step 4
  if (results.skipUpload) {
    skipped.push("Step 4: Supabase upload (--skip-upload)");
  } else {
    completed.push("Step 4: Animation upload to Supabase");
  }

  // Step 5
  if (results.skipBlooket) {
    skipped.push("Step 5: Blooket upload (--skip-blooket)");
    manual.push("Upload Blooket CSV manually at blooket.com");
  } else if (results.blooketUrl) {
    completed.push(`Step 5: Blooket upload (${results.blooketUrl})`);
  } else {
    failed.push("Step 5: Blooket upload (no URL captured)");
    manual.push("Upload Blooket CSV manually at blooket.com");
  }

  // Step 6
  if (results.skipSchoology) {
    skipped.push("Step 6: Schoology posting (--skip-schoology)");
    manual.push("Post lesson links to Schoology manually");
  } else {
    completed.push("Step 6: Schoology posting");
  }

  // Step 7
  completed.push("Step 7: Lesson URLs generated");

  // Print results
  if (completed.length > 0) {
    console.log("Completed:");
    for (const c of completed) {
      console.log(`  [x] ${c}`);
    }
  }

  if (skipped.length > 0) {
    console.log("\nSkipped:");
    for (const s of skipped) {
      console.log(`  [-] ${s}`);
    }
  }

  if (failed.length > 0) {
    console.log("\nFailed:");
    for (const f of failed) {
      console.log(`  [!] ${f}`);
    }
  }

  if (manual.length > 0) {
    console.log("\nRemaining manual steps:");
    for (const m of manual) {
      console.log(`  [ ] ${m}`);
    }
  }

  if (manual.length === 0 && failed.length === 0) {
    console.log("\nAll steps completed successfully. No manual steps remaining.");
  }

  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  let { unit, lesson } = opts;

  // Track results for the summary
  const results = {
    autoDetected: false,
    driveIdsSource: "none",
    driveIdCount: 0,
    skipIngest: opts.skipIngest,
    skipRender: opts.skipRender,
    skipUpload: opts.skipUpload,
    skipBlooket: opts.skipBlooket,
    skipSchoology: opts.skipSchoology,
    codexResults: null,
    blooketUrl: null,
  };

  // Step 0: Auto-detect from calendar if --auto
  if (opts.auto) {
    const detected = step0_detectTomorrow();
    unit = detected.unit;
    lesson = detected.lesson;
    results.autoDetected = true;
  }

  // Step 0.5: Drive video lookup (whenever no --drive-ids provided and not skipping ingest)
  if (opts.driveIds.length === 0 && !opts.skipIngest) {
    const ids = await step05_driveVideoLookup(unit, lesson, opts);
    if (ids.length > 0) {
      opts.driveIds.push(...ids);
      // Determine the source: if they came from the index, we'll have printed a message
      // If they came from interactive input, we know that too
      if (existsSync(DRIVE_VIDEO_INDEX_PATH)) {
        try {
          const index = JSON.parse(readFileSync(DRIVE_VIDEO_INDEX_PATH, "utf-8"));
          const topic = `${unit}.${lesson}`;
          const indexMatches = (index.videos || []).filter((v) => v.topic === topic);
          if (indexMatches.length > 0 && ids.length === indexMatches.length &&
              ids[0] === indexMatches.sort((a, b) => (a.video_number || 0) - (b.video_number || 0))[0].file_id) {
            results.driveIdsSource = "index";
          } else {
            results.driveIdsSource = "manual";
          }
        } catch {
          results.driveIdsSource = "manual";
        }
      } else {
        results.driveIdsSource = "manual";
      }
    }
  } else if (opts.driveIds.length > 0) {
    results.driveIdsSource = "args";
  }

  results.driveIdCount = opts.driveIds.length;

  console.log(`\n========================================`);
  console.log(`  Lesson Prep Pipeline v3 -- Unit ${unit}, Lesson ${lesson}`);
  console.log(`========================================\n`);

  // Step 1: Video ingest via CDP
  if (opts.skipIngest) {
    console.log("=== Step 1: Video ingest skipped (--skip-ingest) ===\n");
  } else if (opts.driveIds.length === 0) {
    console.log("=== Step 1: No Drive IDs provided, skipping ingest ===\n");
  } else {
    step1_videoIngest(unit, lesson, opts.driveIds);
  }

  // Step 2: Parallel content generation
  results.codexResults = await step2_contentGeneration(unit, lesson);

  // Step 3: Render animations
  if (opts.skipRender) {
    console.log("=== Step 3: Rendering skipped (--skip-render) ===\n");
  } else {
    step3_renderAnimations(unit, lesson);
  }

  // Step 4: Upload animations
  if (opts.skipUpload) {
    console.log("=== Step 4: Upload skipped (--skip-upload) ===\n");
  } else {
    step4_uploadAnimations(unit, lesson);
  }

  // Step 5: Upload Blooket
  let blooketUrl = null;
  if (opts.skipBlooket) {
    console.log("=== Step 5: Blooket upload skipped (--skip-blooket) ===\n");
  } else {
    blooketUrl = step5_uploadBlooket(unit, lesson);
    results.blooketUrl = blooketUrl;
  }

  // Step 6: Post to Schoology
  if (opts.skipSchoology) {
    console.log("=== Step 6: Schoology posting skipped (--skip-schoology) ===\n");
  } else {
    step6_postToSchoology(unit, lesson, blooketUrl);
  }

  // Step 7: Generate URLs
  step7_lessonUrls(unit, lesson);

  // Step 8: Print summary
  step8_summary(unit, lesson, results);

  console.log("Pipeline complete.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
