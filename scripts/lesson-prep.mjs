#!/usr/bin/env node
/**
 * lesson-prep.mjs — Orchestrates the full lesson-prep pipeline (v2).
 *
 * Usage:
 *   node scripts/lesson-prep.mjs --auto
 *   node scripts/lesson-prep.mjs --unit 6 --lesson 5 --drive-ids "ID1" "ID2"
 *
 * Pipeline (7 steps):
 *   Step 1: whats-tomorrow.mjs          (if --auto)
 *   Step 2: aistudio-ingest.mjs via CDP (interactive — user picks Drive files)
 *   Step 3: Parallel codex --full-auto  (worksheet + cartridge)
 *   Step 4: render-animations.mjs
 *   Step 5: upload-animations.mjs
 *   Step 6: lesson-urls.mjs
 *   Step 7: Print manual checklist
 */

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

// ── Script paths ─────────────────────────────────────────────────────────────
const SCRIPTS = {
  whatsTomorrow: "C:/Users/ColsonR/Agent/scripts/whats-tomorrow.mjs",
  aistudioIngest: "C:/Users/ColsonR/Agent/scripts/aistudio-ingest.mjs",
  renderAnimations: "C:/Users/ColsonR/Agent/scripts/render-animations.mjs",
  uploadAnimations: "C:/Users/ColsonR/lrsl-driller/scripts/upload-animations.mjs",
  lessonUrls: "C:/Users/ColsonR/Agent/scripts/lesson-urls.mjs",
};

const WORKING_DIRS = {
  worksheet: "C:/Users/ColsonR/apstats-live-worksheet",
  driller: "C:/Users/ColsonR/lrsl-driller",
};

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
        "  -u, --unit       Unit number  (required unless --auto)\n" +
        "  -l, --lesson     Lesson number (required unless --auto)\n" +
        "  --drive-ids      Space-separated Google Drive file IDs\n" +
        "  --auto           Detect unit+lesson from whats-tomorrow.mjs, prompt for drive IDs\n" +
        "  --skip-ingest    Skip Step 2 (video context files already exist)\n" +
        "  --skip-render    Skip Step 4 (Manim rendering)\n" +
        "  --skip-upload    Skip Step 5 (Supabase animation upload)"
    );
    process.exit(1);
  }

  return { unit, lesson, driveIds, auto, skipIngest, skipRender, skipUpload };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Step 1: Auto-detect from tomorrow's calendar ─────────────────────────────

function step1_detectTomorrow() {
  if (!existsSync(SCRIPTS.whatsTomorrow)) {
    console.error("Error: whats-tomorrow.mjs not found. Cannot use --auto.");
    process.exit(1);
  }

  console.log("=== Step 1: Auto-detecting tomorrow's topic ===\n");

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

// ── Step 2: CDP video ingest ─────────────────────────────────────────────────

function step2_videoIngest(unit, lesson, driveIds) {
  if (!existsSync(SCRIPTS.aistudioIngest)) {
    console.error("Error: aistudio-ingest.mjs not found.");
    process.exit(1);
  }

  console.log(`=== Step 2: Video ingest via CDP (${driveIds.length} video(s)) ===\n`);

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

// ── Step 3: Parallel content generation ──────────────────────────────────────

function launchCodexSession(label, prompt, workingDir) {
  return new Promise((resolve) => {
    console.log(`  Starting ${label}...`);

    const proc = spawn(
      "codex",
      ["--full-auto", "--prompt", prompt],
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

async function step3_contentGeneration(unit, lesson) {
  console.log("=== Step 3: Parallel content generation (Codex) ===\n");

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

// ── Step 4: Render Manim animations ──────────────────────────────────────────

function step4_renderAnimations(unit, lesson) {
  if (!existsSync(SCRIPTS.renderAnimations)) {
    console.error("Error: render-animations.mjs not found.");
    process.exit(1);
  }

  console.log("=== Step 4: Rendering Manim animations ===\n");

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

// ── Step 5: Upload animations to Supabase ────────────────────────────────────

function step5_uploadAnimations(unit, lesson) {
  if (!existsSync(SCRIPTS.uploadAnimations)) {
    console.log("upload-animations.mjs not found, skipping upload.\n");
    return;
  }

  console.log("=== Step 5: Uploading animations to Supabase ===\n");

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

// ── Step 6: Generate lesson URLs ─────────────────────────────────────────────

function step6_lessonUrls(unit, lesson) {
  if (!existsSync(SCRIPTS.lessonUrls)) {
    console.log("lesson-urls.mjs not found, skipping URL assembly.\n");
    return;
  }

  console.log("=== Step 6: Generating lesson URLs ===\n");

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

// ── Step 7: Print manual checklist ───────────────────────────────────────────

function step7_checklist(unit, lesson) {
  console.log("=== Remaining Manual Steps ===");
  console.log(`[ ] Upload u${unit}_l${lesson}_blooket.csv to blooket.com`);
  console.log("[ ] Post all 4 links to Schoology");
  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  let { unit, lesson } = opts;

  // Step 1: Auto-detect from calendar if --auto
  if (opts.auto) {
    const detected = step1_detectTomorrow();
    unit = detected.unit;
    lesson = detected.lesson;
  }

  // Prompt for Drive IDs if --auto and none provided and not skipping ingest
  if (opts.auto && opts.driveIds.length === 0 && !opts.skipIngest) {
    const input = await ask(
      "Enter Google Drive file IDs for the video(s), separated by spaces:\nDrive ID(s): "
    );
    if (input) {
      const ids = input.split(/\s+/).filter(Boolean);
      opts.driveIds.push(...ids);
    }
  }

  console.log(`\n========================================`);
  console.log(`  Lesson Prep Pipeline v2 — Unit ${unit}, Lesson ${lesson}`);
  console.log(`========================================\n`);

  // Step 2: Video ingest via CDP
  if (opts.skipIngest) {
    console.log("=== Step 2: Video ingest skipped (--skip-ingest) ===\n");
  } else if (opts.driveIds.length === 0) {
    console.log("=== Step 2: No Drive IDs provided, skipping ingest ===\n");
  } else {
    step2_videoIngest(unit, lesson, opts.driveIds);
  }

  // Step 3: Parallel content generation
  await step3_contentGeneration(unit, lesson);

  // Step 4: Render animations
  if (opts.skipRender) {
    console.log("=== Step 4: Rendering skipped (--skip-render) ===\n");
  } else {
    step4_renderAnimations(unit, lesson);
  }

  // Step 5: Upload animations
  if (opts.skipUpload) {
    console.log("=== Step 5: Upload skipped (--skip-upload) ===\n");
  } else {
    step5_uploadAnimations(unit, lesson);
  }

  // Step 6: Generate URLs
  step6_lessonUrls(unit, lesson);

  // Step 7: Manual checklist
  step7_checklist(unit, lesson);

  console.log("Pipeline complete.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
