#!/usr/bin/env node
/**
 * lesson-prep.mjs — Single entry point that orchestrates the full lesson prep pipeline.
 *
 * Usage:
 *   node scripts/lesson-prep.mjs --unit 6 --lesson 4 --videos "C:/path/to/6-4a.mp4" "C:/path/to/6-4b.mp4"
 *   node scripts/lesson-prep.mjs --auto
 *
 * Pipeline:
 *   Phase A (sequential): whats-tomorrow detection + video ingest
 *   Phase B (parallel):   CC sessions for worksheet + drills
 *   Phase C (sequential): upload animations, assemble URLs, print manual steps
 */

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

// ── Script paths ─────────────────────────────────────────────────────────────
const SCRIPTS = {
  whatsTomorrow: "C:/Users/ColsonR/Agent/scripts/whats-tomorrow.mjs",
  videoIngest: "C:/Users/ColsonR/apstats-live-worksheet/video-ingest.mjs",
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
  let videos = [];
  let auto = false;
  let skipIngest = false;
  let skipUpload = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--auto") {
      auto = true;
    } else if (arg === "--skip-ingest") {
      skipIngest = true;
    } else if (arg === "--skip-upload") {
      skipUpload = true;
    } else if ((arg === "--unit" || arg === "-u") && args[i + 1]) {
      unit = parseInt(args[++i], 10);
    } else if ((arg === "--lesson" || arg === "-l") && args[i + 1]) {
      lesson = parseInt(args[++i], 10);
    } else if (arg === "--videos") {
      // Collect all subsequent args until the next flag or end of args
      i++;
      while (i < args.length && !args[i].startsWith("-")) {
        videos.push(args[i]);
        i++;
      }
      i--; // back up so the for-loop increment lands correctly
    }
  }

  if (!auto && (!unit || !lesson)) {
    console.error(
      "Usage: node scripts/lesson-prep.mjs --unit <U> --lesson <L> [--videos <path>...]\n" +
        "       node scripts/lesson-prep.mjs --auto\n\n" +
        "Options:\n" +
        "  -u, --unit       Unit number  (required unless --auto)\n" +
        "  -l, --lesson     Lesson number (required unless --auto)\n" +
        "  --videos         Space-separated video file paths\n" +
        "  --auto           Use whats-tomorrow.mjs to determine unit+lesson\n" +
        "  --skip-ingest    Skip video transcription\n" +
        "  --skip-upload    Skip Supabase animation upload"
    );
    process.exit(1);
  }

  return { unit, lesson, videos, auto, skipIngest, skipUpload };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function scriptExists(scriptPath) {
  return existsSync(scriptPath);
}

/**
 * Run a child process via spawn and return a promise that resolves on exit.
 * Inherits stdio so the user sees output in real time.
 */
function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: "inherit",
      shell: true,
      ...options,
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });
}

/**
 * Run whats-tomorrow.mjs and parse its output to extract unit and lesson.
 * Looks for topic lines like "Topic: 6.4 — Setting Up a Test for p"
 */
function detectFromTomorrow() {
  if (!scriptExists(SCRIPTS.whatsTomorrow)) {
    console.error("Error: whats-tomorrow.mjs not found. Cannot use --auto.");
    process.exit(1);
  }

  console.log("=== Phase A: Auto-detecting tomorrow's topic ===\n");

  let output;
  try {
    output = execSync(`node "${SCRIPTS.whatsTomorrow}"`, {
      encoding: "utf-8",
    });
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

/**
 * Interactive prompt for video file paths.
 * Returns array of paths (possibly empty if user skips).
 */
async function promptForVideos(unit, lesson) {
  console.log(`Find the AP Classroom video(s) for Topic ${unit}.${lesson}.`);
  console.log(`Enter video file paths separated by spaces, or press Enter to skip.\n`);

  const input = await ask("Video path(s): ");

  if (!input) {
    console.log("No videos provided — skipping video ingest.\n");
    return [];
  }

  // Parse paths — handle quoted paths with spaces
  const paths = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    paths.push(m[1] || m[2]);
  }

  // Validate paths exist
  const valid = [];
  for (const p of paths) {
    if (existsSync(p)) {
      valid.push(p);
    } else {
      console.log(`  Warning: "${p}" not found, skipping.`);
    }
  }

  if (valid.length === 0) {
    console.log("No valid video files found — skipping ingest.\n");
  } else {
    console.log(`\n${valid.length} video(s) ready for ingest.\n`);
  }

  return valid;
}

// ── Phase A: Video ingest ────────────────────────────────────────────────────

async function phaseA(unit, lesson, videos, skipIngest) {
  if (skipIngest) {
    console.log("=== Phase A: Video ingest skipped (--skip-ingest) ===\n");
    return;
  }

  if (videos.length === 0) {
    console.log("=== Phase A: No videos provided, skipping ingest ===\n");
    return;
  }

  if (!scriptExists(SCRIPTS.videoIngest)) {
    console.log(
      "=== Phase A: video-ingest.mjs not found, skipping ingest ===\n"
    );
    return;
  }

  console.log(`=== Phase A: Ingesting ${videos.length} video(s) ===\n`);

  const videoArgs = videos.map((v) => `"${v}"`).join(" ");
  try {
    execSync(
      `node "${SCRIPTS.videoIngest}" ${unit} ${lesson} ${videoArgs}`,
      { stdio: "inherit", cwd: WORKING_DIRS.worksheet }
    );
    console.log("\nVideo ingest complete.\n");
  } catch (e) {
    console.error(`\nVideo ingest failed: ${e.message}`);
    console.error("Continuing with remaining pipeline steps...\n");
  }
}

// ── Phase B: Parallel CC sessions ────────────────────────────────────────────

function launchCodexSession(label, prompt, workingDir) {
  return new Promise((resolve) => {
    console.log(`  Starting ${label}...`);

    const proc = spawn(
      "codex",
      [
        "--full-auto",
        "--prompt",
        prompt,
      ],
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

async function phaseB(unit, lesson) {
  console.log("=== Phase B: Launching parallel Codex sessions ===\n");

  const worksheetPrompt =
    `Generate a follow-along worksheet, AI grading prompts, and Blooket CSV for Topic ${unit}.${lesson}. ` +
    `Read the video context files in u${unit}/ for the lesson content. ` +
    `Follow the patterns established by existing worksheets like u6_lesson3_live.html.`;

  const drillerPrompt =
    `Extend the apstats-u6-inference-prop cartridge with Topic ${unit}.${lesson} modes and generate Manim animations. ` +
    `Read the spec pattern from existing modes in manifest.json. ` +
    `Add new modes to manifest, generator, grading-rules, and ai-grader-prompt. ` +
    `Generate animation .py files in animations/.`;

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

// ── Phase C: Distribution ────────────────────────────────────────────────────

async function phaseC(unit, lesson, skipUpload) {
  console.log("=== Phase C: Distribution ===\n");

  // Upload animations
  if (skipUpload) {
    console.log("Animation upload skipped (--skip-upload).\n");
  } else if (!scriptExists(SCRIPTS.uploadAnimations)) {
    console.log("upload-animations.mjs not found, skipping upload.\n");
  } else {
    try {
      execSync(
        `node "${SCRIPTS.uploadAnimations}" --unit ${unit} --lesson ${lesson}`,
        { stdio: "inherit" }
      );
      console.log();
    } catch (e) {
      console.log(
        "Supabase upload skipped (no credentials or upload failed).\n"
      );
    }
  }

  // Assemble URLs
  if (scriptExists(SCRIPTS.lessonUrls)) {
    try {
      execSync(
        `node "${SCRIPTS.lessonUrls}" --unit ${unit} --lesson ${lesson}`,
        { stdio: "inherit" }
      );
      console.log();
    } catch (e) {
      console.error(`lesson-urls.mjs failed: ${e.message}\n`);
    }
  } else {
    console.log("lesson-urls.mjs not found, skipping URL assembly.\n");
  }

  // Print remaining manual steps
  console.log("=== Remaining Manual Steps ===");
  console.log(`[ ] Upload u${unit}_l${lesson}_blooket.csv to blooket.com`);
  console.log("[ ] Commit + push apstats-live-worksheet");
  console.log("[ ] Commit + push lrsl-driller");
  console.log("[ ] Post all 4 links to Schoology");
  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  let { unit, lesson } = opts;

  // Auto-detect from calendar if --auto
  if (opts.auto) {
    const detected = detectFromTomorrow();
    unit = detected.unit;
    lesson = detected.lesson;

    // If no videos were passed on the command line, prompt interactively
    if (opts.videos.length === 0 && !opts.skipIngest) {
      opts.videos = await promptForVideos(unit, lesson);
    }
  }

  console.log(`\n========================================`);
  console.log(`  Lesson Prep Pipeline — Unit ${unit}, Lesson ${lesson}`);
  console.log(`========================================\n`);

  // Phase A: Video ingest (sequential)
  await phaseA(unit, lesson, opts.videos, opts.skipIngest);

  // Phase B: Parallel CC / Codex sessions
  await phaseB(unit, lesson);

  // Phase C: Distribution (sequential)
  await phaseC(unit, lesson, opts.skipUpload);

  console.log("Pipeline complete.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
