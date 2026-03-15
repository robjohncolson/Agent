#!/usr/bin/env node
/**
 * lesson-prep.mjs — Orchestrates the full lesson-prep pipeline (v3).
 *
 * Usage:
 *   node scripts/lesson-prep.mjs --auto
 *   node scripts/lesson-prep.mjs --unit 6 --lesson 5 --drive-ids "ID1" "ID2"
 *
 * Pipeline (10 steps):
 *   Step 0:   whats-tomorrow.mjs          (if --auto)
 *   Step 0.5: Drive video lookup           (if --auto and no --drive-ids)
 *   Step 1:   aistudio-ingest.mjs via CDP  (interactive — user picks Drive files)
 *   Step 2:   Parallel codex --full-auto   (worksheet + cartridge)
 *   Step 3:   render-animations.mjs        (--quality m)
 *   Step 4:   upload-animations.mjs        (Supabase)
 *   Step 5:   upload-blooket.mjs           (get Blooket URL)
 *   Step 6:   post-to-schoology.mjs        (--auto-urls --blooket <url>)
 *   Step 7:   lesson-urls.mjs              (print + clipboard)
 *   Step 8:   Commit and push downstream repos
 *   Step 9:   Print summary
 */

import "dotenv/config";
import { pipeline as pipelineEvents } from './lib/event-log.mjs';
import { execFileSync, execSync, spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import {
  buildBlooketPrompt,
  buildDrillsPrompt,
  buildNewCartridgePrompt,
  buildWorksheetPrompt,
  readVideoContext,
} from "./lib/build-codex-prompts.mjs";
import { validateBlooketCsv, autoFixBlooketCsv } from "./lib/validate-blooket-csv.mjs";
import {
  upsertLesson,
  updateUrl,
  updateStatus,
  computeUrls,
  getLesson,
  getSchoologyLinks,
} from "./lib/lesson-registry.mjs";
import { createSpinner, stepBanner, formatStatus as tuiFormatStatus } from "./lib/tui.mjs";
import { verifySupabaseAssets } from "./lib/verify-supabase.mjs";
import { checkWithLLM, analyzeError } from "./lib/llm-check.mjs";
import {
  AGENT_ROOT,
  SCRIPTS,
  WORKING_DIRS,
  DRIVE_VIDEO_INDEX_PATH,
  WORKSHEET_REPO,
  DOWNSTREAM_REPOS,
  CARTRIDGES_DIR,
} from "./lib/paths.mjs";
import { runPipeline } from "./lib/task-runner.mjs";
import { resolveFolderPath, determineSchoolWeek as sharedDetermineSchoolWeek } from './lib/resolve-folder-path.mjs';
import { loadVideoLinks } from './lib/load-video-links.mjs';



// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let unit = null;
  let lesson = null;
  const driveIds = [];
  let auto = false;
  let autoPush = false;
  let skipIngest = false;
  let skipRender = false;
  let skipUpload = false;
  let skipBlooket = false;
  let skipSchoology = false;
  let targetDate = null;
  let noFolder = false;
  let force = false;
  let strictLlm = false;
  let skipLlm = false;
  let useTaskRunner = true;  // default: use declarative task runner
  const forceSteps = new Set();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--auto") {
      auto = true;
    } else if (arg === "--auto-push") {
      autoPush = true;
    } else if (arg === "--date") {
      targetDate = args[++i]; // YYYY-MM-DD
    } else if (arg === "--no-folder") {
      noFolder = true;
    } else if (arg === "--force") {
      force = true;
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
    } else if (arg === "--strict-llm") {
      strictLlm = true;
    } else if (arg === "--skip-llm") {
      skipLlm = true;
    } else if (arg === "--force-step" && args[i + 1]) {
      forceSteps.add(args[++i]);
    } else if (arg === "--task-runner") {
      useTaskRunner = true;
    } else if (arg === "--legacy") {
      useTaskRunner = false;
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

  if (auto) autoPush = true;

  if (!auto && (!unit || !lesson)) {
    console.error(
      "Usage: node scripts/lesson-prep.mjs --unit <U> --lesson <L> [--drive-ids <ID>...]\n" +
        "       node scripts/lesson-prep.mjs --auto\n\n" +
        "Options:\n" +
        "  -u, --unit          Unit number  (required unless --auto)\n" +
        "  -l, --lesson        Lesson number (required unless --auto)\n" +
        "  --drive-ids         Space-separated Google Drive file IDs\n" +
        "  --auto              Detect unit+lesson from whats-tomorrow.mjs, auto-lookup Drive IDs\n" +
        "  --auto-push         (deprecated, push is now always on in Step 8)\n" +
        "  --skip-ingest       Skip Step 1 (video context files already exist)\n" +
        "  --skip-render       Skip Step 3 (Manim rendering)\n" +
        "  --skip-upload       Skip Step 4 (Supabase animation upload)\n" +
        "  --skip-blooket      Skip Step 5 (Blooket upload)\n" +
        "  --skip-schoology    Skip Step 6 (Schoology posting)\n" +
        "  --date YYYY-MM-DD   Target date for calendar lookup and folder creation\n" +
        "  --no-folder         Skip Schoology folder creation (post links at top level)\n" +
        "  --force             Re-run all steps even if registry shows them as done\n" +
        "  --force-step <key>  Force re-run of a specific step (repeatable). Keys: ingest, worksheet, blooketCsv, drills, animations, blooketUpload, schoology\n" +
        "  --strict-llm        Make LLM validation failures fatal (abort pipeline)\n" +
        "  --skip-llm          Skip all LLM semantic checks\n" +
        "  --task-runner       Use the declarative task runner (default)\n" +
        "  --legacy            Use inline orchestration instead of task runner"
    );
    process.exit(1);
  }

  return { unit, lesson, driveIds, auto, autoPush, skipIngest, skipRender, skipUpload, skipBlooket, skipSchoology, targetDate, noFolder, force, forceSteps, strictLlm, skipLlm, useTaskRunner };
}

// ── Resume helpers ───────────────────────────────────────────────────────────

/**
 * Check if a pipeline step can be skipped because the registry shows it as
 * "done" and (optionally) the output artifact exists on disk.
 *
 * Returns { skip: true, reason: "..." } or { skip: false }.
 */
function canResume(registryEntry, stepKey, artifactPath, force, forceSteps) {
  if (forceSteps instanceof Set && forceSteps.has(stepKey)) return { skip: false };
  if (force) return { skip: false };
  if (!registryEntry) return { skip: false };
  const status = registryEntry.status?.[stepKey];
  if (status !== "done" && status !== "skipped") return { skip: false };
  if (artifactPath && !existsSync(artifactPath)) return { skip: false };
  const label = status === "skipped" ? "previously skipped" : "already done";
  return { skip: true, reason: label };
}

// ── Helpers ──────────────────────────────────────────────────────────────────



/**
 * Determine the Schoology quarter folder and week number for a given date.
 * Delegates to shared resolve-folder-path.mjs module.
 */
function determineSchoolWeek(targetDate) {
  return sharedDetermineSchoolWeek(targetDate);
}

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

function step0_detectFromCalendar(targetDate) {
  if (!scriptExists(SCRIPTS.whatsTomorrow)) {
    console.error("Error: whats-tomorrow.mjs not found. Cannot use --auto.");
    process.exit(1);
  }

  const dateArg = targetDate ? ` --date ${targetDate}` : "";
  console.log(`=== Step 0: Detecting topic from calendar${targetDate ? ` (${targetDate})` : " (tomorrow)"} ===\n`);

  let output;
  try {
    output = execSync(`node "${SCRIPTS.whatsTomorrow}"${dateArg}`, { encoding: "utf-8" });
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
      "Could not auto-detect unit and lesson from calendar.\n" +
        "Please specify --unit and --lesson explicitly."
    );
    process.exit(1);
  }

  const unit = parseInt(topicMatch[1], 10);
  const lesson = parseInt(topicMatch[2], 10);

  // Parse day name and date: "Monday, Mar 9"
  const headerMatch = output.match(/^(\w+),\s+(\w+)\s+(\d+)/m);
  const dayName = headerMatch ? headerMatch[1] : null;
  const monthAbbr = headerMatch ? headerMatch[2] : null;
  const dayNum = headerMatch ? parseInt(headerMatch[3], 10) : null;

  // Parse topic description, due, assign from Period B block
  const topicDescMatch = output.match(/Topic:\s+[\d.]+\s+[—–-]\s+(.*)/);
  const dueMatch = output.match(/Due:\s+(.*)/);
  const assignMatch = output.match(/Assign:\s+(.*)/);

  // Build folder description from calendar block
  let folderDesc = null;
  if (topicMatch) {
    const parts = [`${unit}.${lesson}`];
    if (topicDescMatch) parts[0] += ` ${topicDescMatch[1]}`;
    if (dueMatch) parts.push(`Due: ${dueMatch[1]}`);
    if (assignMatch) parts.push(`Assign: ${assignMatch[1]}`);
    folderDesc = parts.join("\n");
  }

  // Build folder title: "Monday 3/9/26"
  let folderTitle = null;
  if (dayName && monthAbbr && dayNum) {
    // Determine year from targetDate or default to current
    let year;
    if (targetDate) {
      year = parseInt(targetDate.split("-")[0], 10) % 100;
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      year = tomorrow.getFullYear() % 100;
    }
    // Convert month abbreviation to number
    const monthMap = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
    const monthNum = monthMap[monthAbbr] || 0;
    folderTitle = `${dayName} ${monthNum}/${dayNum}/${year}`;
  }

  console.log(`Detected: Unit ${unit}, Lesson ${lesson}`);
  if (folderTitle) console.log(`Folder: "${folderTitle}"`);
  console.log();

  // Compute ISO date string for downstream use (quarter/week detection)
  let isoDate = targetDate;
  if (!isoDate && monthAbbr && dayNum) {
    const monthMap2 = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yr = tomorrow.getFullYear();
    isoDate = `${yr}-${monthMap2[monthAbbr] || '01'}-${String(dayNum).padStart(2, '0')}`;
  }

  return { unit, lesson, folderTitle, folderDesc, date: isoDate };
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
    return false;
  }

  console.log(`=== Step 1: Video ingest via CDP (${driveIds.length} video(s)) ===\n`);

  try {
    execSync(
      `node "${SCRIPTS.aistudioIngest}" --unit ${unit} --lesson ${lesson} --drive-ids ${driveIds.join(" ")}`,
      { stdio: "inherit" }
    );
    console.log("\nVideo ingest complete.\n");
    return true;
  } catch (e) {
    console.error(`\nVideo ingest FAILED: ${e.message}\n`);
    return false;
  }
}

// ── Step 2: Parallel content generation ──────────────────────────────────────

function pickPatternArtifact(dir, exactName, pattern, unit, lesson) {
  const exactPath = path.join(dir, exactName);
  if (existsSync(exactPath)) {
    return {
      name: exactName,
      path: exactPath,
      content: readFileSync(exactPath, "utf-8"),
      isFallback: false,
    };
  }

  const candidates = readdirSync(dir)
    .map((name) => {
      const match = name.match(pattern);
      if (!match) {
        return null;
      }

      return {
        name,
        path: path.join(dir, name),
        unit: Number(match[1]),
        lesson: Number(match[2]),
      };
    })
    .filter(Boolean);

  const candidate =
    candidates.find((entry) => entry.unit === unit && entry.lesson === lesson - 1) ||
    candidates
      .filter((entry) => entry.unit === unit && entry.lesson < lesson)
      .sort((a, b) => b.lesson - a.lesson)[0] ||
    candidates.sort((a, b) => b.unit - a.unit || b.lesson - a.lesson)[0];

  if (!candidate) {
    throw new Error(`No pattern file found for ${exactName}`);
  }

  return {
    ...candidate,
    content: readFileSync(candidate.path, "utf-8"),
    isFallback: true,
  };
}

function takeCsvRows(csvText, rowCount) {
  const normalized = csvText.replace(/\r\n/g, "\n");
  const rows = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (char === '"') {
      current += char;
      if (inQuotes && normalized[i + 1] === '"') {
        current += normalized[++i];
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "\n" && !inQuotes) {
      rows.push(current);
      current = "";
      if (rows.length === rowCount) {
        break;
      }
      continue;
    }

    current += char;
  }

  if (rows.length < rowCount && current) {
    rows.push(current);
  }

  return rows.join("\n").trim();
}

function findCartridgePath(unit) {
  const cartridgesDir = path.join(WORKING_DIRS.driller, "cartridges");
  if (!existsSync(cartridgesDir)) {
    return null;
  }
  const entries = readdirSync(cartridgesDir);
  const match = entries.find(
    (e) =>
      e.startsWith(`apstats-u${unit}`) &&
      statSync(path.join(cartridgesDir, e)).isDirectory()
  );
  return match || null;
}

function extractLastCaseBlock(fileContent) {
  const casePattern = /case\s+["']l\d+-[^"']+["']\s*:\s*\{[\s\S]*?\n\s*\}/g;
  const matches = [...fileContent.matchAll(casePattern)];
  if (matches.length > 0) {
    return matches[matches.length - 1][0];
  }
  const lines = fileContent.split("\n");
  return lines.slice(-150).join("\n");
}

function buildManifestExcerpt(unit) {
  const cartridgeName = findCartridgePath(unit);
  if (!cartridgeName) {
    return null;
  }

  const cartridgeDir = path.join(WORKING_DIRS.driller, "cartridges", cartridgeName);
  const manifestPath = path.join(cartridgeDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const lastModes = Array.isArray(manifest.modes) ? manifest.modes.slice(-2) : [];
  const lastMode = lastModes[lastModes.length - 1] || {};

  // Extract generator excerpt
  let generatorExcerpt = "";
  const generatorFilePath = path.join(cartridgeDir, "generator.js");
  if (existsSync(generatorFilePath)) {
    generatorExcerpt = extractLastCaseBlock(readFileSync(generatorFilePath, "utf-8"));
  }

  // Extract grading-rules excerpt
  let gradingRulesExcerpt = "";
  const gradingRulesFilePath = path.join(cartridgeDir, "grading-rules.js");
  if (existsSync(gradingRulesFilePath)) {
    gradingRulesExcerpt = extractLastCaseBlock(readFileSync(gradingRulesFilePath, "utf-8"));
  }

  // Find animation example
  let animationExample = "";
  const animDir = path.join(WORKING_DIRS.driller, "animations");
  if (existsSync(animDir)) {
    const animFiles = readdirSync(animDir)
      .filter((f) => f.startsWith(`apstat_${unit}`) && f.endsWith(".py"))
      .sort()
      .reverse();
    if (animFiles.length > 0) {
      const content = readFileSync(path.join(animDir, animFiles[0]), "utf-8");
      const lines = content.split("\n");
      animationExample = lines.slice(0, 80).join("\n");
    }
  }

  return {
    cartridgeName,
    manifestPath: `cartridges/${cartridgeName}/manifest.json`,
    generatorPath: `cartridges/${cartridgeName}/generator.js`,
    gradingRulesPath: `cartridges/${cartridgeName}/grading-rules.js`,
    metaName: manifest.meta?.name || "",
    metaDescription: manifest.meta?.description || "",
    lastModeId: lastMode.id || "(none)",
    lastModeName: lastMode.name || "(none)",
    lastModesJson: JSON.stringify(lastModes, null, 2),
    generatorExcerpt,
    gradingRulesExcerpt,
    animationExample,
  };
}

function buildTemplateExcerpt() {
  const templateDir = path.join(WORKING_DIRS.driller, "cartridges", "_template");
  const result = {};
  for (const filename of ["manifest.json", "generator.js", "grading-rules.js"]) {
    const filePath = path.join(templateDir, filename);
    if (existsSync(filePath)) {
      result[filename] = readFileSync(filePath, "utf-8");
    }
  }
  return result;
}

function writeTempPromptFile(label, prompt, workingDir) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const promptFile = path.join(
    workingDir,
    `.codex-prompt-${slug}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.md`
  );
  writeFileSync(promptFile, prompt, "utf-8");
  return promptFile;
}

function cleanupTempPromptFile(promptFile) {
  if (!promptFile || !existsSync(promptFile)) {
    return;
  }

  try {
    unlinkSync(promptFile);
  } catch {
    // Best-effort cleanup only.
  }
}

function shouldRetryWithLegacyCodex(output) {
  return /unknown command.*\bexec\b|invalid (sub)?command.*\bexec\b|unrecognized (sub)?command.*\bexec\b|no such command.*\bexec\b/i.test(
    output
  );
}

function launchCodexTask(label, promptFile, workingDir) {
  return new Promise((resolve) => {
    console.log(`  Starting ${label}...`);

    const promptContents = readFileSync(promptFile, "utf-8");
    const isWindows = process.platform === "win32";
    let settled = false;

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupTempPromptFile(promptFile);
      resolve(result);
    };

    const runAttempt = (mode) => {
      const spawnCommand = isWindows
        ? process.env.ComSpec || "cmd.exe"
        : "codex";
      const spawnArgs = isWindows
        ? [
            "/d",
            "/s",
            "/c",
            mode === "exec" ? "codex.cmd exec --full-auto -" : "codex.cmd --full-auto",
          ]
        : mode === "exec"
          ? ["exec", "--full-auto", "-"]
          : ["--full-auto"];
      const proc = spawn(spawnCommand, spawnArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: workingDir,
      });
      let output = "";

      proc.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stdout.write(text);
      });

      proc.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stderr.write(text);
      });

      proc.stdin.write(promptContents);
      proc.stdin.end();

      proc.on("error", (err) => {
        console.error(`  ${label} failed to start: ${err.message}`);
        settle({ label, success: false, error: err.message });
      });

      proc.on("close", (code) => {
        if (code === 0) {
          console.log(
            `  ${label} completed successfully${mode === "pipe" ? " (legacy fallback)." : "."}`
          );
          settle({ label, success: true });
          return;
        }

        if (mode === "exec" && shouldRetryWithLegacyCodex(output)) {
          console.log(`  ${label}: retrying with legacy codex --full-auto fallback...`);
          writeFileSync(promptFile, promptContents, "utf-8");
          runAttempt("pipe");
          return;
        }

        console.error(`  ${label} exited with code ${code}.`);
        settle({ label, success: false, error: `exit code ${code}` });
      });
    };

    runAttempt("exec");
  });
}

function validateFileSize(filePath, minBytes) {
  if (!existsSync(filePath)) {
    return {
      ok: false,
      detail: `${path.basename(filePath)} missing`,
    };
  }

  const size = statSync(filePath).size;
  if (size < minBytes) {
    return {
      ok: false,
      detail: `${path.basename(filePath)} too small (${size} bytes, expected at least ${minBytes})`,
    };
  }

  return {
    ok: true,
    detail: `${path.basename(filePath)} OK (${size} bytes)`,
  };
}

function validateWorksheetTask(unit, lesson) {
  const worksheetPath = path.join(
    WORKING_DIRS.worksheet,
    `u${unit}_lesson${lesson}_live.html`
  );
  const gradingPath = path.join(
    WORKING_DIRS.worksheet,
    `ai-grading-prompts-u${unit}-l${lesson}.js`
  );
  const worksheetValidation = validateFileSize(worksheetPath, 10 * 1024);
  const gradingValidation = validateFileSize(gradingPath, 1024);

  console.log(`    Validation: ${worksheetValidation.detail}`);
  console.log(`    Validation: ${gradingValidation.detail}`);

  if (worksheetValidation.ok && gradingValidation.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    error: [worksheetValidation, gradingValidation]
      .filter((entry) => !entry.ok)
      .map((entry) => entry.detail)
      .join("; "),
  };
}

async function validateBlooketTask(unit, lesson, opts = {}) {
  const blooketPath = path.join(WORKING_DIRS.worksheet, `u${unit}_l${lesson}_blooket.csv`);

  // First, try auto-fix
  const fixResult = autoFixBlooketCsv(blooketPath);
  if (fixResult.fixed) {
    console.log("    Auto-fix applied:");
    fixResult.changes.forEach(c => console.log(`      - ${c}`));
  }

  // Then validate structurally
  const result = validateBlooketCsv(blooketPath);
  if (!result.valid) {
    console.log("    Validation FAILED:");
    result.errors.forEach(e => console.log(`      - ${e}`));
    return { ok: false, error: result.errors.join("; ") };
  }

  console.log("    Validation: Blooket CSV OK (all checks passed)");

  // LLM semantic check (Check 1)
  if (!opts.skipLlm && existsSync(blooketPath)) {
    const csvContent = readFileSync(blooketPath, "utf-8");
    const preview = takeCsvRows(csvContent, 10);
    const llmResult = await checkWithLLM(
      `You are validating a Blooket quiz CSV for AP Statistics Topic ${unit}.${lesson}.\n` +
      `Check for: (1) questions that don't match the topic, (2) incorrect correct answers, ` +
      `(3) duplicate questions, (4) nonsensical answer choices.\n` +
      `Respond with JSON: { "ok": true/false, "issues": ["..."] }`,
      preview,
    );
    if (!llmResult.ok && llmResult.issues.length > 0) {
      console.log("    LLM validation issues:");
      llmResult.issues.forEach(i => console.log(`      - ${i}`));
      if (opts.strictLlm) {
        return { ok: false, error: "LLM: " + llmResult.issues.join("; ") };
      }
    } else if (llmResult.raw !== "skipped (no API key)") {
      console.log("    LLM validation: OK");
    }
  }

  return { ok: true };
}

function validateDrillsTask(unit, lesson) {
  const cartridgeName = findCartridgePath(unit);
  if (!cartridgeName) {
    const error = "No cartridge directory found for unit " + unit;
    console.log(`    Validation: ${error}`);
    return { ok: false, error };
  }
  const manifestPath = path.join(
    WORKING_DIRS.driller,
    "cartridges",
    cartridgeName,
    "manifest.json"
  );
  if (!existsSync(manifestPath)) {
    const error = "manifest.json missing";
    console.log(`    Validation: ${error}`);
    return { ok: false, error };
  }

  const manifestText = readFileSync(manifestPath, "utf-8");
  const modePattern = new RegExp(`"name"\\s*:\\s*"${unit}\\.${lesson}[^"]*"`);
  if (!modePattern.test(manifestText)) {
    const error = `manifest.json does not contain a mode name with ${unit}.${lesson}`;
    console.log(`    Validation: ${error}`);
    return { ok: false, error };
  }

  console.log(`    Validation: manifest.json contains a mode name with ${unit}.${lesson}`);
  return { ok: true };
}

function validateAnimationNames(unit, lesson) {
  const cartridgeName = findCartridgePath(unit);
  if (!cartridgeName) return { ok: true, fixes: 0 };

  const cartridgeDir = path.join(WORKING_DIRS.driller, "cartridges", cartridgeName);
  const manifestPath = path.join(cartridgeDir, "manifest.json");
  if (!existsSync(manifestPath)) return { ok: true, fixes: 0 };

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const animationsDir = path.join(WORKING_DIRS.driller, "animations");
  const lessonPattern = `${unit}.${lesson}`;
  const prefix = `apstat_${unit}${lesson}_`;
  const errors = [];
  let fixes = 0;

  for (const mode of manifest.modes || []) {
    if (!mode.name?.includes(lessonPattern) || !mode.animation) continue;

    const expectedMp4 = path.basename(mode.animation);
    const expectedClass = expectedMp4.replace(".mp4", "");

    if (!existsSync(animationsDir)) {
      errors.push(`animations/ dir missing -- cannot verify "${expectedMp4}"`);
      continue;
    }

    const pyFiles = readdirSync(animationsDir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".py"));

    let found = false;
    let actualClass = null;

    for (const pyFile of pyFiles) {
      const content = readFileSync(path.join(animationsDir, pyFile), "utf8");
      if (content.includes(`class ${expectedClass}(`)) {
        found = true;
        break;
      }
      const classMatch = content.match(/class\s+(\w+)\s*\(\s*Scene\s*\)/);
      if (classMatch) actualClass = classMatch[1];
    }

    if (!found && actualClass) {
      console.log(`    Auto-fix: manifest "${expectedMp4}" -> "${actualClass}.mp4" (matched from .py)`);
      mode.animation = `assets/${actualClass}.mp4`;
      fixes++;
    } else if (!found) {
      errors.push(`Manifest expects "${expectedMp4}" but no .py file defines class ${expectedClass}`);
    }
  }

  if (fixes > 0) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    console.log(`    Patched manifest.json with ${fixes} animation name fix(es)`);
  }

  if (errors.length > 0) {
    return { ok: false, fixes, errors };
  }

  return { ok: true, fixes };
}

async function validateTaskResult(taskKey, unit, lesson, result, opts = {}) {
  if (!result.success) {
    return result;
  }

  console.log(`  Validating ${result.label} outputs...`);

  const validation =
    taskKey === "worksheet"
      ? validateWorksheetTask(unit, lesson)
      : taskKey === "blooket"
        ? await validateBlooketTask(unit, lesson, opts)
        : validateDrillsTask(unit, lesson);

  if (!validation.ok) {
    console.error(`  ${result.label} validation failed: ${validation.error}`);
    return {
      ...result,
      success: false,
      error: validation.error,
    };
  }

  // Layer 2: cross-check animation names after drills validation passes
  if (taskKey === "drills") {
    const animCheck = validateAnimationNames(unit, lesson);
    if (!animCheck.ok) {
      const msg = animCheck.errors.join("; ");
      console.warn(`  Animation name warnings: ${msg}`);
    }
    if (animCheck.fixes > 0) {
      console.log(`  Animation names: ${animCheck.fixes} auto-fixed in manifest`);
    }

    // LLM Check 2: validate animation scripts
    if (!opts.skipLlm) {
      const animDir = path.join(WORKING_DIRS.driller, "animations");
      const prefix = `apstat_${unit}${lesson}_`;
      if (existsSync(animDir)) {
        const pyFiles = readdirSync(animDir).filter(
          f => f.startsWith(prefix) && f.endsWith(".py")
        );
        for (const pyFile of pyFiles) {
          const pyContent = readFileSync(path.join(animDir, pyFile), "utf-8");
          const llmResult = await checkWithLLM(
            `You are reviewing a Manim animation script for AP Statistics Topic ${unit}.${lesson}.\n` +
            `Check for: (1) missing imports, (2) class doesn't extend Scene, ` +
            `(3) undefined variables, (4) obvious runtime errors. ` +
            `Only flag clear bugs, not style issues.\n` +
            `Respond with JSON: { "ok": true/false, "issues": ["..."] }`,
            pyContent,
          );
          if (!llmResult.ok && llmResult.issues.length > 0) {
            console.log(`    LLM check for ${pyFile}:`);
            llmResult.issues.forEach(i => console.log(`      - ${i}`));
            if (opts.strictLlm) {
              return { ...result, success: false, error: "LLM: " + llmResult.issues.join("; ") };
            }
          } else if (llmResult.raw !== "skipped (no API key)") {
            console.log(`    LLM check for ${pyFile}: OK`);
          }
        }
      }
    }
  }

  return result;
}

async function step2_contentGeneration(unit, lesson, opts = {}, skipTasks = new Set()) {
  console.log("=== Step 2: Parallel content generation (Codex) ===\n");
  const failedResults = (error) => [
    { label: "Worksheet + Grading", success: false, error },
    { label: "Blooket CSV", success: false, error },
    { label: "Drills Cartridge", success: false, error },
  ];

  let worksheetPrompt;
  let blooketPrompt;
  let drillsPrompt;

  try {
    const videoContext = readVideoContext(unit, lesson);
    console.log(`  Topic ${unit}.${lesson}: ${videoContext.topicTitle}`);
    console.log(
      `  Video context loaded: ${videoContext.videos.length} video(s) from u${unit}/`
    );

    // Only build prompts for tasks that will actually run
    if (!skipTasks.has("worksheet")) {
      const worksheetPattern = pickPatternArtifact(
        WORKING_DIRS.worksheet,
        `u${unit}_lesson${lesson - 1}_live.html`,
        /^u(\d+)_lesson(\d+)_live\.html$/,
        unit,
        lesson
      );
      const gradingPattern = pickPatternArtifact(
        WORKING_DIRS.worksheet,
        `ai-grading-prompts-u${unit}-l${lesson - 1}.js`,
        /^ai-grading-prompts-u(\d+)-l(\d+)\.js$/,
        unit,
        lesson
      );
      console.log(
        `  Worksheet pattern: ${worksheetPattern.name}${worksheetPattern.isFallback ? " (fallback)" : ""}`
      );
      console.log(
        `  Grading pattern: ${gradingPattern.name}${gradingPattern.isFallback ? " (fallback)" : ""}`
      );
      worksheetPrompt = buildWorksheetPrompt(unit, lesson, videoContext, {
        worksheet: worksheetPattern,
        grading: gradingPattern,
      });
    }

    if (!skipTasks.has("blooket")) {
      const blooketPattern = pickPatternArtifact(
        WORKING_DIRS.worksheet,
        `u${unit}_l${lesson - 1}_blooket.csv`,
        /^u(\d+)_l(\d+)_blooket\.csv$/,
        unit,
        lesson
      );
      console.log(
        `  Blooket pattern: ${blooketPattern.name}${blooketPattern.isFallback ? " (fallback)" : ""}`
      );
      blooketPrompt = buildBlooketPrompt(unit, lesson, videoContext, {
        name: blooketPattern.name,
        content: takeCsvRows(blooketPattern.content, 10),
      });
    }

    if (!skipTasks.has("drills")) {
      const manifestExcerpt = buildManifestExcerpt(unit);
      if (manifestExcerpt) {
        console.log(`  Cartridge found: ${manifestExcerpt.cartridgeName} (extending)`);
        drillsPrompt = buildDrillsPrompt(unit, lesson, videoContext, manifestExcerpt);
      } else {
        console.log(`  No cartridge for unit ${unit} — will create new cartridge`);
        const templateExcerpt = buildTemplateExcerpt();
        let animationExample = "";
        const animDir = path.join(WORKING_DIRS.driller, "animations");
        if (existsSync(animDir)) {
          const animFiles = readdirSync(animDir)
            .filter((f) => f.startsWith("apstat_") && f.endsWith(".py"))
            .sort()
            .reverse();
          if (animFiles.length > 0) {
            const content = readFileSync(path.join(animDir, animFiles[0]), "utf-8");
            animationExample = content.split("\n").slice(0, 80).join("\n");
          }
        }
        drillsPrompt = buildNewCartridgePrompt(unit, lesson, videoContext, templateExcerpt, animationExample);
      }
    }
  } catch (e) {
    console.error(`  Step 2 setup failed: ${e.message}`);
    console.log();
    return failedResults(e.message);
  }

  const allTasks = [
    {
      key: "worksheet",
      label: "Worksheet + Grading",
      workingDir: WORKING_DIRS.worksheet,
      prompt: worksheetPrompt,
    },
    {
      key: "blooket",
      label: "Blooket CSV",
      workingDir: WORKING_DIRS.worksheet,
      prompt: blooketPrompt,
    },
    {
      key: "drills",
      label: "Drills Cartridge",
      workingDir: WORKING_DIRS.driller,
      prompt: drillsPrompt,
    },
  ];

  // Separate into tasks to run and tasks to skip
  const tasksToRun = allTasks.filter(t => !skipTasks.has(t.key));
  const skippedResults = allTasks
    .filter(t => skipTasks.has(t.key))
    .map(t => {
      console.log(`  ${t.label}: skipped (already done)`);
      return { label: t.label, success: true, skipped: true };
    });

  let runResults = [];
  if (tasksToRun.length > 0) {
    runResults = await Promise.all(
      tasksToRun.map(async (task) => {
        let promptFile = null;

        try {
          promptFile = writeTempPromptFile(task.label, task.prompt, task.workingDir);
          const launchResult = await launchCodexTask(
            task.label,
            promptFile,
            task.workingDir
          );
          return await validateTaskResult(task.key, unit, lesson, launchResult, opts);
        } catch (e) {
          cleanupTempPromptFile(promptFile);
          return {
            label: task.label,
            success: false,
            error: e.message,
          };
        }
      })
    );
  }

  // Merge results in original task order
  const resultsByLabel = new Map();
  for (const r of [...skippedResults, ...runResults]) resultsByLabel.set(r.label, r);
  const results = allTasks.map(t => resultsByLabel.get(t.label));

  console.log();

  for (const r of results) {
    const status = r.success ? "OK" : `FAILED (${r.error})`;
    console.log(`  ${r.label}: ${status}`);
  }

  // LLM Check 4: diagnose failures
  if (!opts.skipLlm) {
    const failures = results.filter(r => !r.success && r.error);
    for (const f of failures) {
      const diagnosis = await analyzeError(f.error, { step: `Step 2: ${f.label}`, unit, lesson });
      if (diagnosis.diagnosis) {
        console.log(`\n  AI diagnosis for ${f.label}:`);
        console.log(`    Diagnosis: ${diagnosis.diagnosis}`);
        if (diagnosis.suggestedFix) {
          console.log(`    Suggested fix: ${diagnosis.suggestedFix}`);
        }
      }
    }
  }

  console.log();

  // Incremental render test: if drills task produced .py files, try a quick render
  const drillsResult = results.find(
    (r) => r.label === "Drills Cartridge" || r.label === "Cartridge + Animations"
  );
  if (drillsResult?.success) {
    try {
      const animDir = `${WORKING_DIRS.driller}/animations`;
      const prefix = `apstat_${unit}${lesson}_`;
      if (existsSync(animDir)) {
        const pyFiles = readdirSync(animDir).filter(
          (f) => f.startsWith(prefix) && f.endsWith(".py")
        );
        if (pyFiles.length > 0) {
          console.log(`  Testing ${pyFiles.length} animation file(s) with quick render...`);
          try {
            const output = execSync(
              `node "${SCRIPTS.renderAnimations}" --unit ${unit} --lesson ${lesson} --quality l`,
              { encoding: "utf-8", timeout: 120000 }
            );
            process.stdout.write(output);
          } catch (renderErr) {
            if (typeof renderErr.stdout === "string" && renderErr.stdout) {
              process.stdout.write(renderErr.stdout);
            }
            console.log(`  Quick render test failed (non-blocking): ${renderErr.message}`);
          }
          console.log();
        }
      }
    } catch (e) {
      console.log(`  Quick render test failed (non-blocking): ${e.message}\n`);
    }
  }

  return results;
}

// ── Step 3: Render Manim animations ──────────────────────────────────────────

function step3_renderAnimations(unit, lesson) {
  if (!scriptExists(SCRIPTS.renderAnimations)) {
    console.error("Error: render-animations.mjs not found.");
    return { success: false, rendered: 0, failed: 0 };
  }

  console.log("=== Step 3: Rendering Manim animations ===\n");

  try {
    const output = execSync(
      `node "${SCRIPTS.renderAnimations}" --unit ${unit} --lesson ${lesson} --quality m`,
      { encoding: "utf-8" }
    );
    process.stdout.write(output);

    const summaryMatch = output.match(/(\d+) succeeded, (\d+) failed/);
    const rendered = summaryMatch ? parseInt(summaryMatch[1], 10) : 0;
    const failed = summaryMatch ? parseInt(summaryMatch[2], 10) : 0;

    return { success: true, rendered, failed };
  } catch (e) {
    if (typeof e.stdout === "string" && e.stdout) {
      process.stdout.write(e.stdout);
    }
    if (typeof e.stderr === "string" && e.stderr) {
      process.stderr.write(e.stderr);
    }
    console.error(`\nrender-animations.mjs failed: ${e.message}\n`);
    return { success: false, rendered: 0, failed: 0 };
  }
}

// ── Step 4: Upload animations to Supabase ────────────────────────────────────

function step4_uploadAnimations(unit, lesson) {
  if (!scriptExists(SCRIPTS.uploadAnimations)) {
    console.log("upload-animations.mjs not found, skipping upload.\n");
    return { success: false };
  }

  console.log("=== Step 4: Uploading animations to Supabase ===\n");

  try {
    const output = execSync(
      `node "${SCRIPTS.uploadAnimations}" --unit ${unit} --lesson ${lesson}`,
      { encoding: "utf-8", cwd: WORKING_DIRS.driller }
    );
    process.stdout.write(output);
    return { success: true, output };
  } catch (e) {
    if (typeof e.stdout === "string" && e.stdout) {
      process.stdout.write(e.stdout);
    }
    console.log("Supabase upload skipped (no credentials or upload failed).\n");
    return { success: false };
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

async function step6_postToSchoology(unit, lesson, blooketUrl, calendarContext) {
  if (!scriptExists(SCRIPTS.postSchoology)) {
    console.log("post-to-schoology.mjs not found, skipping Schoology posting.\n");
    return false;
  }

  console.log(stepBanner(6, "Posting links to Schoology") + "\n");

  const args = [
    SCRIPTS.postSchoology,
    "--unit", String(unit),
    "--lesson", String(lesson),
    "--auto-urls",
    "--with-videos",
    "--no-prompt",
  ];

  // Auto-heal: add --heal when previous run failed or has missing links
  const healEntry = getLesson(unit, lesson);
  const needsHeal = healEntry?.status?.schoology === "failed"
    || (() => {
      const scLinks = healEntry?.schoologyLinks;
      if (!scLinks) return false;
      return Object.values(scLinks).some(
        (l) => l && (l.status === "failed" || !l.status)
      );
    })();

  if (needsHeal) {
    args.push("--heal");
    console.log("  [auto-heal] Previous Schoology posting incomplete — adding --heal flag");
  }

  if (blooketUrl) {
    args.push("--blooket", blooketUrl);
  }

  // Check if folder already exists in registry (from a previous run)
  const regEntry = getLesson(unit, lesson);
  if (regEntry?.urls?.schoologyFolder) {
    args.push("--target-folder", regEntry.urls.schoologyFolder);
  }
  // Use calendar context if available (from --auto mode)
  else if (calendarContext && calendarContext.folderTitle) {
    const weekInfo = calendarContext.date
      ? determineSchoolWeek(calendarContext.date)
      : null;
    if (weekInfo) {
      args.push("--folder-path", weekInfo.folderPath.replace(/\//g, '::'));
      console.log(`  Folder path: ${weekInfo.folderPath} (${weekInfo.quarter}, week ${weekInfo.weekNum})`);
    }
    args.push("--create-folder", calendarContext.folderTitle);
    if (calendarContext.folderDesc) {
      const desc = calendarContext.folderDesc
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
      args.push("--folder-desc", desc);
    }
  }
  // Fallback: resolve folder from topic schedule (works without --auto)
  else {
    try {
      const folderInfo = await resolveFolderPath(unit, lesson);
      args.push("--folder-path", folderInfo.folderPath.join('::'));
      args.push("--create-folder", folderInfo.dayTitle);
      console.log(`  Folder resolved from schedule: ${folderInfo.folderPath.join(' → ')} / ${folderInfo.dayTitle}`);
      if (folderInfo.isFuture) {
        console.log(`  (future lesson — routing to work-ahead/future)`);
      }
    } catch (err) {
      console.warn(`  WARNING: Could not resolve folder: ${err.message}`);
      console.warn(`  Links will post to root unless --no-folder is set.`);
    }
  }

  // Calendar link deprecated — replaced by ap_stats_roadmap.html

  const postSpinner = createSpinner("Posting to Schoology");
  try {
    postSpinner.start();
    execFileSync(
      "node",
      args,
      { stdio: "inherit", timeout: 300000 }
    );
    postSpinner.succeed("Posted to Schoology");
    console.log();
    return true;
  } catch (e) {
    if (postSpinner.isSpinning) {
      postSpinner.fail("Schoology posting failed");
    }
    console.error(`Schoology posting failed: ${e.message}`);
    console.error("Continuing with remaining pipeline steps...\n");
    return false;
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

// ── Step 8: Commit and push downstream repos ─────────────────────────────────

function commitAndPushRepos(unit, lesson, autoPush) {
  console.log("=== Step 8: Commit and push downstream repos ===\n");

  const repos = DOWNSTREAM_REPOS;

  const repoResults = [];

  for (const repo of repos) {
    try {
      const status = execSync("git status -s", {
        cwd: repo.path,
        encoding: "utf-8",
      }).trim();

      if (!status) {
        console.log(`  ${repo.name}: no changes to commit`);
        repoResults.push({ name: repo.name, action: "clean" });
        continue;
      }

      console.log(`  ${repo.name}: found changes`);

      for (const pattern of repo.patterns) {
        try {
          execSync(`git add ${pattern}`, {
            cwd: repo.path,
            encoding: "utf-8",
          });
        } catch {
          // Pattern may not match any files
        }
      }

      const staged = execSync("git diff --cached --name-only", {
        cwd: repo.path,
        encoding: "utf-8",
      }).trim();

      if (!staged) {
        console.log(`  ${repo.name}: no matching files to stage`);
        repoResults.push({ name: repo.name, action: "nothing-staged" });
        continue;
      }

      const commitMsg = `pipeline: add U${unit} L${lesson} content`;
      const commitOutput = execSync(
        `git commit -m "${commitMsg}"`,
        { cwd: repo.path, encoding: "utf-8" }
      );
      const hashMatch = commitOutput.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
      const hash = hashMatch ? hashMatch[1] : "unknown";
      console.log(`  ${repo.name}: committed ${hash}`);

      try {
        execSync("git push", { cwd: repo.path, encoding: "utf-8", timeout: 30000 });
        console.log(`  ${repo.name}: pushed to origin`);
        repoResults.push({ name: repo.name, action: "pushed", hash });
      } catch (pushErr) {
        console.log(`  ${repo.name}: push failed: ${pushErr.message}`);
        repoResults.push({ name: repo.name, action: "committed", hash, pushError: pushErr.message });
      }
    } catch (e) {
      console.error(`  ${repo.name}: error: ${e.message}`);
      repoResults.push({ name: repo.name, action: "error", error: e.message });
    }
  }

  console.log();
  return repoResults;
}

// ── Step 9: Print summary ────────────────────────────────────────────────────

function step9_summary(unit, lesson, results) {
  console.log("=== Step 9: Pipeline Summary ===\n");

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
  } else if (results.renderResult) {
    const rc = `(${results.renderResult.rendered} succeeded, ${results.renderResult.failed} failed)`;
    if (results.renderResult.success) {
      completed.push(`Step 3: Manim rendering ${rc}`);
    } else {
      failed.push(`Step 3: Manim rendering ${rc}`);
    }
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

  // Step 8
  if (results.repoCommits) {
    for (const rc of results.repoCommits) {
      if (rc.action === "pushed") {
        completed.push(`Step 8: ${rc.name} committed (${rc.hash}) and pushed`);
      } else if (rc.action === "committed" && rc.pushError) {
        failed.push(`Step 8: ${rc.name} committed (${rc.hash}) but push failed: ${rc.pushError}`);
      } else if (rc.action === "committed") {
        completed.push(`Step 8: ${rc.name} committed (${rc.hash}) — not pushed`);
      } else if (rc.action === "clean") {
        skipped.push(`Step 8: ${rc.name} — no changes`);
      } else if (rc.action === "nothing-staged") {
        skipped.push(`Step 8: ${rc.name} — no matching files to stage`);
      } else if (rc.action === "error") {
        failed.push(`Step 8: ${rc.name} — ${rc.error}`);
      }
    }
  }

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
    renderResult: null,
    uploadResult: null,
    blooketUrl: null,
    repoCommits: null,
  };

  // ── Preflight: warn about missing env vars for enabled steps ──────────────
  const preflightWarnings = [];
  if (!opts.skipUpload) {
    if (!process.env.SUPABASE_URL) preflightWarnings.push("SUPABASE_URL not set (needed for Step 4: animation upload)");
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) preflightWarnings.push("SUPABASE_SERVICE_ROLE_KEY not set (needed for Step 4: animation upload)");
  }
  if (preflightWarnings.length > 0) {
    console.log("=== Preflight Warnings ===");
    for (const w of preflightWarnings) {
      console.log(`  [!] ${w}`);
    }
    console.log("  (Pipeline will continue — affected steps may fail)\n");
  }

  // Calendar context for folder creation (populated by step0 or --date)
  let calendarContext = null;

  // Step 0: Auto-detect from calendar if --auto or --date
  if (opts.auto || opts.targetDate) {
    const detected = step0_detectFromCalendar(opts.targetDate);
    if (opts.auto) {
      unit = detected.unit;
      lesson = detected.lesson;
    }
    results.autoDetected = true;
    if (!opts.noFolder) {
      const resolvedDate = opts.targetDate || (() => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().slice(0, 10);
      })();
      calendarContext = {
        folderTitle: detected.folderTitle,
        folderDesc: detected.folderDesc,
        date: resolvedDate,
      };
    }
  }

  const existingEntry = getLesson(unit, lesson);

  // Initialize registry entry with computed URLs
  const computedUrls = computeUrls(unit, lesson);
  upsertLesson(unit, lesson, {
    topic: calendarContext?.folderTitle || `Topic ${unit}.${lesson}`,
    date: calendarContext?.date || null,
    urls: computedUrls,
  });

  pipelineEvents.started('lesson-prep', { unit, lesson });
  const pipelineStart = Date.now();

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

  // ── Task Runner Mode ─────────────────────────────────────────────────────
  // When --task-runner is set, delegate to runPipeline() instead of inline steps.
  // Pre-pipeline setup (Steps 0, 0.5) has already run above.
  if (opts.useTaskRunner) {
    console.log(`\n========================================`);
    console.log(`  Lesson Prep Pipeline (Task Runner) -- Unit ${unit}, Lesson ${lesson}`);
    console.log(`========================================\n`);

    const pipelinePath = path.join(AGENT_ROOT, 'pipelines', 'lesson-prep.json');

    // Seed pipeline context from pre-pipeline data
    const context = new Map();
    if (opts.driveIds.length > 0) {
      context.set('drive_ids', opts.driveIds.join(' '));
    }
    if (calendarContext) {
      if (calendarContext.folderTitle) context.set('folder_title', calendarContext.folderTitle);
      if (calendarContext.folderDesc) {
        context.set('folder_desc', calendarContext.folderDesc.replace(/\n/g, '\\n'));
      }
      // Calendar URL deprecated — replaced by ap_stats_roadmap.html
      if (calendarContext.date) {
        const weekInfo = determineSchoolWeek(calendarContext.date);
        if (weekInfo) context.set('folder_path', weekInfo.folderPath.replace(/\//g, '::'));
      }
    }

    // Fallback: resolve folder from topic schedule when no calendar context
    if (!calendarContext || !calendarContext.folderTitle) {
      try {
        const folderInfo = await resolveFolderPath(unit, lesson, {
          date: opts.targetDate || null,
        });
        context.set('folder_path', folderInfo.folderPath.join('::'));
        context.set('folder_title', folderInfo.dayTitle);
        console.log(`  Folder resolved from schedule: ${folderInfo.folderPath.join(' → ')} / ${folderInfo.dayTitle}`);
        if (folderInfo.isFuture) {
          console.log(`  (future lesson — routing to work-ahead/future)`);
        }
      } catch (err) {
        console.warn(`  WARNING: Could not resolve folder: ${err.message}`);
      }
    }

    // Existing blooket URL from registry
    if (existingEntry?.urls?.blooket) {
      context.set('blooket', existingEntry.urls.blooket);
    }
    // Existing folder from registry
    if (existingEntry?.urls?.schoologyFolder) {
      context.set('schoologyFolder', existingEntry.urls.schoologyFolder);
    }

    // Map --skip-* flags to task runner skipSteps
    const skipSteps = new Set();
    if (opts.skipIngest)    skipSteps.add('ingest');
    if (opts.skipRender)    skipSteps.add('render-animations');
    if (opts.skipUpload)    skipSteps.add('upload-animations');
    if (opts.skipBlooket)   skipSteps.add('upload-blooket');
    if (opts.skipSchoology) skipSteps.add('schoology-post');

    const { results: taskResults, success } = await runPipeline(pipelinePath, { unit, lesson }, {
      force: opts.force,
      forceSteps: opts.forceSteps,
      skipSteps,
      context,
    });

    // Print summary
    console.log('\n========================================');
    console.log('  Pipeline Results');
    console.log('========================================\n');
    for (const [stepId, result] of taskResults) {
      const icon = result.status === 'completed' ? '[x]'
        : result.status === 'skipped' ? '[-]'
        : '[!]';
      const detail = result.reason || result.error || '';
      const duration = result.duration_ms > 0 ? ` (${(result.duration_ms / 1000).toFixed(1)}s)` : '';
      console.log(`  ${icon} ${stepId}: ${result.status}${duration}${detail ? ` — ${detail}` : ''}`);
    }
    console.log(`\n  ${success ? 'SUCCESS' : 'FAILED'}\n`);

    // Post-pipeline reconciliation check
    if (success) {
      console.log('\n  Running post-pipeline reconciliation...');
      try {
        const treePath = path.join(AGENT_ROOT, 'state', 'schoology-tree.json');
        if (existsSync(treePath)) {
          const { reconcileLesson } = await import('./lib/schoology-reconcile.mjs');
          const tree = JSON.parse(readFileSync(treePath, 'utf-8'));
          const entry = getLesson(unit, lesson);
          const report = reconcileLesson(unit, lesson, entry, tree);
          if (report.issues.length === 0) {
            console.log(`  [ok] Lesson ${unit}.${lesson} reconciled — no issues`);
          } else {
            console.log(`  [!!] ${report.issues.length} reconciliation issue(s):`);
            for (const issue of report.issues) {
              console.log(`       [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.detail}`);
            }
          }
        } else {
          console.log('  [--] No schoology-tree.json — skipping reconciliation');
        }
      } catch (err) {
        console.warn(`  [!!] Reconciliation failed: ${err.message}`);
      }
    }

    return;
  }

  console.log(`\n========================================`);
  console.log(`  Lesson Prep Pipeline v3 -- Unit ${unit}, Lesson ${lesson}`);
  console.log(`========================================\n`);

  if (existingEntry && !opts.force) {
    const status = existingEntry.status || {};
    const doneSteps = Object.entries(status).filter(([, s]) => s === "done" || s === "skipped");
    if (doneSteps.length > 0) {
      console.log(`Registry: Resuming — ${doneSteps.length} step(s) already completed for ${unit}.${lesson}`);
      for (const [step, state] of doneSteps) {
        console.log(`  ${step}: ${state}`);
      }
      console.log("  (use --force to re-run all steps)\n");
    }
  } else if (opts.force && existingEntry) {
    console.log("Registry: --force specified, will re-run all steps.\n");
  }

  // ── Resume-aware artifact paths ───────────────────────────────────────────
  const worksheetPath = path.join(WORKING_DIRS.worksheet, `u${unit}_lesson${lesson}_live.html`);
  const gradingPath = path.join(WORKING_DIRS.worksheet, `ai-grading-prompts-u${unit}-l${lesson}.js`);
  const blooketCsvPath = path.join(WORKING_DIRS.worksheet, `u${unit}_l${lesson}_blooket.csv`);

  // Step 1: Video ingest via CDP
  const step1Resume = canResume(existingEntry, "ingest", null, opts.force, opts.forceSteps);
  let step1ok = false;
  let ranStep1 = false;
  if (opts.skipIngest) {
    console.log("=== Step 1: Video ingest skipped (--skip-ingest) ===\n");
    step1ok = true;
  } else if (step1Resume.skip) {
    console.log(`=== Step 1: Video ingest — ${step1Resume.reason} (registry) ===\n`);
    step1ok = true;
  } else if (opts.driveIds.length === 0) {
    console.log("=== Step 1: No Drive IDs provided, skipping ingest ===\n");
    step1ok = true;
  } else {
    ranStep1 = true;
    const step1Start = Date.now();
    pipelineEvents.stepStarted('lesson-prep', 'ingest');
    step1ok = step1_videoIngest(unit, lesson, opts.driveIds);
    if (step1ok) {
      pipelineEvents.stepCompleted('lesson-prep', 'ingest', Date.now() - step1Start);
    } else {
      pipelineEvents.stepFailed('lesson-prep', 'ingest', new Error('Video ingest failed'));
    }
  }

  if (ranStep1) {
    updateStatus(unit, lesson, "ingest", step1ok ? "done" : "failed");
  }

  // Fix 5a: Auto-populate apVideos after ingest (array of { key, url, title })
  if (step1ok) {
    const videoLinks = loadVideoLinks(unit, lesson);
    if (videoLinks.length > 0) {
      upsertLesson(unit, lesson, { urls: { apVideos: videoLinks } });
      console.log(`  Auto-populated apVideos: ${videoLinks.length} video(s)`);
    }
  }

  if (!step1ok) {
    console.error("*** Step 1 failed — cannot proceed to content generation. ***");
    console.error("*** Fix the issue above and re-run, or use --skip-ingest. ***\n");
    step9_summary(unit, lesson, results);
    console.log("Pipeline aborted after Step 1.");
    return;
  }

  // Step 2: Parallel content generation
  const step2WorksheetResume = canResume(existingEntry, "worksheet", worksheetPath, opts.force, opts.forceSteps);
  const step2BlooketResume = canResume(existingEntry, "blooketCsv", blooketCsvPath, opts.force, opts.forceSteps);
  const step2DrillsResume = canResume(existingEntry, "drills", null, opts.force, opts.forceSteps);

  // Registry self-heal: if artifact exists on disk but status is stale, mark done
  const healTargets = [
    { resume: step2WorksheetResume, key: "worksheet", path: worksheetPath },
    { resume: step2BlooketResume, key: "blooketCsv", path: blooketCsvPath },
  ];
  for (const ht of healTargets) {
    if (!ht.resume.skip && ht.path && existsSync(ht.path)) {
      try {
        const st = statSync(ht.path);
        if (st.size > 0) {
          console.log(`  Registry heal: ${ht.key} artifact found on disk (${st.size}B), marking done`);
          updateStatus(unit, lesson, ht.key, "done");
          ht.resume.skip = true;
          ht.resume.reason = "healed (artifact exists)";
        }
      } catch { /* stat failed, don't heal */ }
    }
  }

  // Build per-task skip set
  const step2SkipTasks = new Set();
  if (step2WorksheetResume.skip) step2SkipTasks.add("worksheet");
  if (step2BlooketResume.skip) step2SkipTasks.add("blooket");
  if (step2DrillsResume.skip) step2SkipTasks.add("drills");

  if (step2SkipTasks.size === 3) {
    // Fast path: all tasks already done
    console.log("=== Step 2: Content generation — all tasks already done (registry) ===");
    console.log(`  Worksheet: ${step2WorksheetResume.reason}`);
    console.log(`  Blooket CSV: ${step2BlooketResume.reason}`);
    console.log(`  Drills: ${step2DrillsResume.reason}\n`);
    results.codexResults = [
      { label: "Worksheet + Grading", success: true, skipped: true },
      { label: "Blooket CSV", success: true, skipped: true },
      { label: "Drills Cartridge", success: true, skipped: true },
    ];
  } else {
    // Selective run: only launch tasks that aren't already done
    if (step2SkipTasks.size > 0) {
      const skippedNames = [];
      if (step2SkipTasks.has("worksheet")) skippedNames.push(`Worksheet (${step2WorksheetResume.reason})`);
      if (step2SkipTasks.has("blooket")) skippedNames.push(`Blooket CSV (${step2BlooketResume.reason})`);
      if (step2SkipTasks.has("drills")) skippedNames.push(`Drills (${step2DrillsResume.reason})`);
      console.log(`  Skipping ${skippedNames.length} task(s): ${skippedNames.join(", ")}`);
    }
    const step2Start = Date.now();
    pipelineEvents.stepStarted('lesson-prep', 'content-gen');
    results.codexResults = await step2_contentGeneration(unit, lesson, opts, step2SkipTasks);
    const step2Ok = results.codexResults && results.codexResults.some(r => r.success);
    if (step2Ok) {
      pipelineEvents.stepCompleted('lesson-prep', 'content-gen', Date.now() - step2Start);
    } else {
      pipelineEvents.stepFailed('lesson-prep', 'content-gen', new Error('Content generation failed'));
    }
    const step2StatusByLabel = {
      "Worksheet + Grading": "worksheet",
      "Blooket CSV": "blooketCsv",
      "Drills Cartridge": "drills",
      "Cartridge + Animations": "drills",
    };
    for (const taskResult of results.codexResults || []) {
      if (taskResult.skipped) continue;  // don't overwrite registry for skipped tasks
      const stepKey = step2StatusByLabel[taskResult.label];
      if (!stepKey) continue;
      updateStatus(unit, lesson, stepKey, taskResult.success ? "done" : "failed");
    }
  }
  const step2ok = results.codexResults && results.codexResults.some(r => r.success);

  // Fix 5b: Auto-populate drills URL after content-gen
  if (step2ok) {
    const drillsResult = results.codexResults?.find(
      r => (r.label === "Drills Cartridge" || r.label === "Cartridge + Animations") && r.success
    );
    if (drillsResult) {
      const cartridgeMap = { "5": "apstats-u5-sampling-dist", "6": "apstats-u6-inference-prop", "7": "apstats-u7-mean-ci" };
      const cartridgeId = cartridgeMap[String(unit)];
      if (cartridgeId) {
        try {
          const manifestPath = path.join(CARTRIDGES_DIR, cartridgeId, "manifest.json");
          const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
          const prefix = `${unit}.${lesson}`;
          const match = (manifest.modes || []).find(m => m.name?.startsWith(prefix));
          if (match) {
            const drillsUrl = `https://lrsl-driller.vercel.app/platform/app.html?c=${cartridgeId}&level=${match.id}`;
            updateUrl(unit, lesson, "drills", drillsUrl);
            console.log(`  Auto-populated drills URL: ${drillsUrl}`);
          }
        } catch (e) {
          console.warn(`  Could not auto-populate drills URL: ${e.message}`);
        }
      }
    }
  }

  if (!step2ok) {
    console.error("*** Step 2 failed — no content was generated. ***");
    console.error("*** Fix the issue above and re-run. ***\n");
    step7_lessonUrls(unit, lesson);
    step9_summary(unit, lesson, results);
    console.log("Pipeline aborted after Step 2.");
    return;
  }

  // Check for animation files before running steps 3 and 4
  const animDir = path.join(WORKING_DIRS.driller, "animations");
  const animPrefix = `apstat_${unit}${lesson}_`;
  const hasAnimFiles = existsSync(animDir) &&
    readdirSync(animDir).some(f => f.startsWith(animPrefix) && f.endsWith(".py"));

  // Step 3: Render animations
  const step3Resume = canResume(existingEntry, "animations", null, opts.force, opts.forceSteps);
  if (opts.skipRender) {
    console.log("=== Step 3: Rendering skipped (--skip-render) ===\n");
  } else if (step3Resume.skip) {
    console.log(`=== Step 3: Animations — ${step3Resume.reason} (registry) ===\n`);
  } else if (!hasAnimFiles) {
    console.log(`=== Step 3: No animation files for ${unit}.${lesson} — skipping render ===\n`);
    updateStatus(unit, lesson, "animations", "skipped");
  } else {
    const step3Start = Date.now();
    pipelineEvents.stepStarted('lesson-prep', 'render-animations');
    results.renderResult = step3_renderAnimations(unit, lesson);
    if (results.renderResult?.success) {
      pipelineEvents.stepCompleted('lesson-prep', 'render-animations', Date.now() - step3Start);
    } else {
      pipelineEvents.stepFailed('lesson-prep', 'render-animations', new Error('Render animations failed'));
    }
    updateStatus(unit, lesson, "animations", results.renderResult?.success ? "done" : "failed");
  }

  // Step 4: Upload animations
  if (opts.skipUpload) {
    console.log("=== Step 4: Upload skipped (--skip-upload) ===\n");
  } else if (step3Resume.skip) {
    console.log(`=== Step 4: Animation upload — ${step3Resume.reason} (registry) ===\n`);
  } else if (!hasAnimFiles) {
    console.log(`=== Step 4: No animation files for ${unit}.${lesson} — skipping upload ===\n`);
  } else {
    const step4Start = Date.now();
    pipelineEvents.stepStarted('lesson-prep', 'upload-animations');
    results.uploadResult = step4_uploadAnimations(unit, lesson);
    if (results.uploadResult?.success) {
      pipelineEvents.stepCompleted('lesson-prep', 'upload-animations', Date.now() - step4Start);
    } else {
      pipelineEvents.stepFailed('lesson-prep', 'upload-animations', new Error('Animation upload failed'));
    }

    // Verify uploaded assets are publicly accessible
    if (results.uploadResult?.success && process.env.SUPABASE_URL) {
      const cartridgeName = findCartridgePath(unit);
      if (cartridgeName) {
        const cartridgeDir = path.join(WORKING_DIRS.driller, "cartridges", cartridgeName);
        const manifestPath = path.join(cartridgeDir, "manifest.json");
        if (existsSync(manifestPath)) {
          const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
          const lessonPattern = `${unit}.${lesson}`;
          const assetUrls = (manifest.modes || [])
            .filter(m => m.name?.includes(lessonPattern) && m.animation)
            .map(m => {
              const asset = m.animation.replace(/^assets\//, "");
              return `${process.env.SUPABASE_URL}/storage/v1/object/public/videos/animations/${cartridgeName}/${asset}`;
            });

          if (assetUrls.length > 0) {
            console.log(`  Verifying ${assetUrls.length} Supabase asset(s)...`);
            const verification = await verifySupabaseAssets(assetUrls);
            if (verification.failed.length > 0) {
              console.warn(`  [!] ${verification.failed.length} asset(s) NOT accessible:`);
              for (const f of verification.failed) {
                console.warn(`      ${f.url} (${f.error || `HTTP ${f.status}`})`);
              }
            } else {
              console.log(`  All ${verification.verified.length} asset(s) verified accessible.`);
            }
          }
        }
      }
    }
  }

  // Step 5: Upload Blooket
  const step5Resume = canResume(existingEntry, "blooketUpload", null, opts.force, opts.forceSteps);
  let blooketUrl = existingEntry?.urls?.blooket || null;
  if (opts.skipBlooket) {
    console.log("=== Step 5: Blooket upload skipped (--skip-blooket) ===\n");
  } else if (step5Resume.skip && blooketUrl) {
    console.log(`=== Step 5: Blooket upload — ${step5Resume.reason} (registry) ===`);
    console.log(`  URL: ${blooketUrl}\n`);
    results.blooketUrl = blooketUrl;
  } else {
    const step5Start = Date.now();
    pipelineEvents.stepStarted('lesson-prep', 'upload-blooket');
    blooketUrl = step5_uploadBlooket(unit, lesson);
    results.blooketUrl = blooketUrl;
    if (blooketUrl) {
      pipelineEvents.stepCompleted('lesson-prep', 'upload-blooket', Date.now() - step5Start);
      updateStatus(unit, lesson, "blooketUpload", "done");
      updateUrl(unit, lesson, "blooket", blooketUrl);
    } else {
      pipelineEvents.stepFailed('lesson-prep', 'upload-blooket', new Error('Blooket upload failed or no URL captured'));
      updateStatus(unit, lesson, "blooketUpload", "failed");
    }
  }

  // Step 6: Post to Schoology
  const step6Resume = canResume(existingEntry, "schoology", null, opts.force, opts.forceSteps);
  if (opts.skipSchoology) {
    console.log(stepBanner(6, "Schoology posting skipped (--skip-schoology)") + "\n");
  } else if (step6Resume.skip) {
    console.log(stepBanner(6, `Schoology posting — ${step6Resume.reason} (registry)`) + "\n");
  } else {
    const step6Start = Date.now();
    pipelineEvents.stepStarted('lesson-prep', 'schoology-post');
    const schoologyOk = await step6_postToSchoology(unit, lesson, blooketUrl, calendarContext);
    if (schoologyOk) {
      pipelineEvents.stepCompleted('lesson-prep', 'schoology-post', Date.now() - step6Start);
    } else {
      pipelineEvents.stepFailed('lesson-prep', 'schoology-post', new Error('Schoology posting failed'));
    }
    updateStatus(unit, lesson, "schoology", schoologyOk ? "done" : "failed");
    // Show per-link status summary
    const postScLinks = getSchoologyLinks(unit, lesson);
    if (postScLinks) {
      console.log("  Schoology link status:");
      for (const [key, entry] of Object.entries(postScLinks)) {
        const st = entry?.status || "unknown";
        console.log(`    ${key.padEnd(16)} ${tuiFormatStatus(st)}`);
      }
    }

    // Check 3: verify posted URLs are reachable
    if (schoologyOk && !opts.skipLlm) {
      const freshEntry = getLesson(unit, lesson);
      const urlsToCheck = [
        freshEntry?.urls?.worksheet,
        freshEntry?.urls?.drills,
        freshEntry?.urls?.quiz,
      ].filter(Boolean);

      if (urlsToCheck.length > 0) {
        console.log(`  Verifying ${urlsToCheck.length} posted URL(s) are reachable...`);
        const { verified, failed } = await verifySupabaseAssets(urlsToCheck, { timeout: 10000 });
        if (failed.length > 0) {
          console.warn(`  [!] ${failed.length} URL(s) returned errors:`);
          for (const f of failed) {
            console.warn(`      ${f.url} (${f.error || `HTTP ${f.status}`})`);
          }
        } else {
          console.log(`  All ${verified.length} URL(s) are reachable.`);
        }
      }
    }
  }

  // Step 6.5: Verify Schoology links for both periods
  try {
    const verifyScript = path.join(AGENT_ROOT, "scripts", "schoology-verify.mjs");
    console.log(stepBanner(6.5, "Verifying Schoology links (both periods)") + "\n");
    const step65Start = Date.now();
    pipelineEvents.stepStarted('lesson-prep', 'verify-schoology');
    execSync(`node "${verifyScript}" --unit ${unit} --lesson ${lesson}`, { stdio: "inherit", timeout: 120000 });
    pipelineEvents.stepCompleted('lesson-prep', 'verify-schoology', Date.now() - step65Start);
    console.log();
  } catch (e) {
    pipelineEvents.stepFailed('lesson-prep', 'verify-schoology', e);
    console.warn("Schoology verification failed or found missing links (non-fatal).\n");
  }

  // Step 7: Generate URLs
  const step7Start = Date.now();
  pipelineEvents.stepStarted('lesson-prep', 'generate-urls');
  step7_lessonUrls(unit, lesson);
  pipelineEvents.stepCompleted('lesson-prep', 'generate-urls', Date.now() - step7Start);

  // Step 7.5: Export registry sidecar for roadmap app
  try {
    const exportScript = path.join(AGENT_ROOT, "scripts", "export-registry.mjs");
    execSync(`node "${exportScript}"`, { stdio: "inherit" });
    console.log("Registry sidecar exported successfully.\n");
  } catch (e) {
    console.warn("Registry sidecar export failed (non-fatal):", e.message, "\n");
  }

  // Step 8: Commit and push downstream repos
  const step8Start = Date.now();
  pipelineEvents.stepStarted('lesson-prep', 'commit-push');
  results.repoCommits = commitAndPushRepos(unit, lesson, opts.autoPush);
  pipelineEvents.stepCompleted('lesson-prep', 'commit-push', Date.now() - step8Start);

  // Step 9: Print summary
  step9_summary(unit, lesson, results);

  pipelineEvents.completed('lesson-prep', { unit, lesson, duration_ms: Date.now() - pipelineStart });
  console.log("Pipeline complete.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
