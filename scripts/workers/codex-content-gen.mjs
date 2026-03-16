#!/usr/bin/env node
/**
 * codex-content-gen.mjs — Standalone CLI worker for a single content-generation
 * task (worksheet, blooket, or drills).  Called by the task runner.
 *
 * Usage:
 *   node scripts/workers/codex-content-gen.mjs --task worksheet --unit 6 --lesson 5
 *   node scripts/workers/codex-content-gen.mjs --task blooket   --unit 6 --lesson 5
 *   node scripts/workers/codex-content-gen.mjs --task drills    --unit 6 --lesson 5
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  readVideoContext,
  buildWorksheetPrompt,
  buildBlooketPrompt,
  buildDrillsPrompt,
  buildNewCartridgePrompt,
} from "../lib/build-codex-prompts.mjs";
import { WORKING_DIRS } from "../lib/paths.mjs";
import { findCartridgePath } from "../lib/course-metadata.mjs";
import { updateStatus } from "../lib/lesson-registry.mjs";
import { validateBlooketCsv, autoFixBlooketCsv } from "../lib/validate-blooket-csv.mjs";

// ── Try importing from codex-launcher; fall back to inline copies ────────────

let launchCodexTask, writeTempPromptFile, cleanupTempPromptFile;

try {
  const launcher = await import("../lib/codex-launcher.mjs");
  launchCodexTask       = launcher.launchCodexTask;
  writeTempPromptFile   = launcher.writeTempPromptFile;
  cleanupTempPromptFile = launcher.cleanupTempPromptFile;
} catch {
  // ── Inline fallbacks (copied from lesson-prep.mjs) ──────────────────────

  const { spawn } = await import("node:child_process");

  writeTempPromptFile = function writeTempPromptFile(label, prompt, workingDir) {
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const promptFile = path.join(
      workingDir,
      `.codex-prompt-${slug}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.md`,
    );
    writeFileSync(promptFile, prompt, "utf-8");
    return promptFile;
  };

  cleanupTempPromptFile = function cleanupTempPromptFile(promptFile) {
    if (!promptFile || !existsSync(promptFile)) return;
    try { unlinkSync(promptFile); } catch { /* best-effort */ }
  };

  function shouldRetryWithLegacyCodex(output) {
    return /unknown command.*\bexec\b|invalid (sub)?command.*\bexec\b|unrecognized (sub)?command.*\bexec\b|no such command.*\bexec\b/i.test(
      output,
    );
  }

  launchCodexTask = function launchCodexTask(label, promptFile, workingDir) {
    return new Promise((resolve) => {
      console.log(`  Starting ${label}...`);

      const promptContents = readFileSync(promptFile, "utf-8");
      const isWindows = process.platform === "win32";
      let settled = false;

      const settle = (result) => {
        if (settled) return;
        settled = true;
        cleanupTempPromptFile(promptFile);
        resolve(result);
      };

      const runAttempt = (mode) => {
        const spawnCommand = isWindows
          ? process.env.ComSpec || "cmd.exe"
          : "codex";
        const spawnArgs = isWindows
          ? ["/d", "/s", "/c", mode === "exec" ? "codex.cmd exec --full-auto -" : "codex.cmd --full-auto"]
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
              `  ${label} completed successfully${mode === "pipe" ? " (legacy fallback)." : "."}`,
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
  };
}

// ── Helper functions (copied from lesson-prep.mjs) ───────────────────────────

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
      if (!match) return null;
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
      if (rows.length === rowCount) break;
      continue;
    }

    current += char;
  }

  if (rows.length < rowCount && current) {
    rows.push(current);
  }

  return rows.join("\n").trim();
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
  if (!cartridgeName) return null;

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

// ── Task-specific prompt builders & validators ───────────────────────────────

function buildWorksheetTask(unit, lesson, videoContext) {
  const worksheetPattern = pickPatternArtifact(
    WORKING_DIRS.worksheet,
    `u${unit}_lesson${lesson - 1}_live.html`,
    /^u(\d+)_lesson(\d+)_live\.html$/,
    unit,
    lesson,
  );
  const gradingPattern = pickPatternArtifact(
    WORKING_DIRS.worksheet,
    `ai-grading-prompts-u${unit}-l${lesson - 1}.js`,
    /^ai-grading-prompts-u(\d+)-l(\d+)\.js$/,
    unit,
    lesson,
  );
  console.log(
    `  Worksheet pattern: ${worksheetPattern.name}${worksheetPattern.isFallback ? " (fallback)" : ""}`,
  );
  console.log(
    `  Grading pattern: ${gradingPattern.name}${gradingPattern.isFallback ? " (fallback)" : ""}`,
  );

  const prompt = buildWorksheetPrompt(unit, lesson, videoContext, {
    worksheet: worksheetPattern,
    grading: gradingPattern,
  });

  return { prompt, workingDir: WORKING_DIRS.worksheet, label: "Worksheet + Grading" };
}

function validateWorksheetOutput(unit, lesson) {
  const worksheetPath = path.join(
    WORKING_DIRS.worksheet,
    `u${unit}_lesson${lesson}_live.html`,
  );
  const gradingPath = path.join(
    WORKING_DIRS.worksheet,
    `ai-grading-prompts-u${unit}-l${lesson}.js`,
  );
  const worksheetValidation = validateFileSize(worksheetPath, 10 * 1024);
  const gradingValidation = validateFileSize(gradingPath, 1024);

  console.log(`  Validation: ${worksheetValidation.detail}`);
  console.log(`  Validation: ${gradingValidation.detail}`);

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

function buildBlooketTask(unit, lesson, videoContext) {
  const blooketPattern = pickPatternArtifact(
    WORKING_DIRS.worksheet,
    `u${unit}_l${lesson - 1}_blooket.csv`,
    /^u(\d+)_l(\d+)_blooket\.csv$/,
    unit,
    lesson,
  );
  console.log(
    `  Blooket pattern: ${blooketPattern.name}${blooketPattern.isFallback ? " (fallback)" : ""}`,
  );

  const prompt = buildBlooketPrompt(unit, lesson, videoContext, {
    name: blooketPattern.name,
    content: takeCsvRows(blooketPattern.content, 10),
  });

  return { prompt, workingDir: WORKING_DIRS.worksheet, label: "Blooket CSV" };
}

function validateBlooketOutput(unit, lesson) {
  const blooketPath = path.join(WORKING_DIRS.worksheet, `u${unit}_l${lesson}_blooket.csv`);

  // Auto-fix first
  const fixResult = autoFixBlooketCsv(blooketPath);
  if (fixResult.fixed) {
    console.log("  Auto-fix applied:");
    fixResult.changes.forEach((c) => console.log(`    - ${c}`));
  }

  // Structural validation
  const result = validateBlooketCsv(blooketPath);
  if (!result.valid) {
    console.log("  Validation FAILED:");
    result.errors.forEach((e) => console.log(`    - ${e}`));
    return { ok: false, error: result.errors.join("; ") };
  }

  console.log("  Validation: Blooket CSV OK (all checks passed)");
  return { ok: true };
}

function buildDrillsTask(unit, lesson, videoContext) {
  const manifestExcerpt = buildManifestExcerpt(unit);
  let prompt;

  if (manifestExcerpt) {
    console.log(`  Cartridge found: ${manifestExcerpt.cartridgeName} (extending)`);
    prompt = buildDrillsPrompt(unit, lesson, videoContext, manifestExcerpt);
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
    prompt = buildNewCartridgePrompt(unit, lesson, videoContext, templateExcerpt, animationExample);
  }

  return { prompt, workingDir: WORKING_DIRS.driller, label: "Drills Cartridge" };
}

function validateDrillsOutput(unit, lesson) {
  const cartridgeName = findCartridgePath(unit);
  if (!cartridgeName) {
    const error = "No cartridge directory found for unit " + unit;
    console.log(`  Validation: ${error}`);
    return { ok: false, error };
  }
  const manifestPath = path.join(
    WORKING_DIRS.driller,
    "cartridges",
    cartridgeName,
    "manifest.json",
  );
  if (!existsSync(manifestPath)) {
    const error = "manifest.json missing";
    console.log(`  Validation: ${error}`);
    return { ok: false, error };
  }

  const manifestText = readFileSync(manifestPath, "utf-8");
  const modePattern = new RegExp(`"name"\\s*:\\s*"${unit}\\.${lesson}[^"]*"`);
  if (!modePattern.test(manifestText)) {
    const error = `manifest.json does not contain a mode name with ${unit}.${lesson}`;
    console.log(`  Validation: ${error}`);
    return { ok: false, error };
  }

  console.log(`  Validation: manifest.json contains a mode name with ${unit}.${lesson}`);
  return { ok: true };
}

// ── Registry key mapping ─────────────────────────────────────────────────────

const REGISTRY_KEYS = {
  worksheet: "worksheet",
  blooket: "blooketCsv",
  drills: "drills",
};

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      task:   { type: "string" },
      unit:   { type: "string" },
      lesson: { type: "string" },
    },
    strict: true,
  });

  const taskName = values.task;
  const unit     = Number(values.unit);
  const lesson   = Number(values.lesson);

  if (!taskName || !["worksheet", "blooket", "drills"].includes(taskName)) {
    console.error("Error: --task must be one of: worksheet, blooket, drills");
    process.exit(1);
  }
  if (!Number.isInteger(unit) || unit <= 0) {
    console.error("Error: --unit must be a positive integer");
    process.exit(1);
  }
  if (!Number.isInteger(lesson) || lesson <= 0) {
    console.error("Error: --lesson must be a positive integer");
    process.exit(1);
  }

  console.log(`\n=== codex-content-gen: ${taskName} for Topic ${unit}.${lesson} ===\n`);

  // 1. Read video context
  let videoContext;
  try {
    videoContext = readVideoContext(unit, lesson);
    console.log(`  Topic ${unit}.${lesson}: ${videoContext.topicTitle}`);
    console.log(`  Video context loaded: ${videoContext.videos.length} video(s) from u${unit}/`);
  } catch (e) {
    console.error(`  Failed to read video context: ${e.message}`);
    updateStatus(unit, lesson, REGISTRY_KEYS[taskName], "failed");
    process.exit(1);
  }

  // 2. Build the task-specific prompt
  let taskInfo;
  try {
    if (taskName === "worksheet") {
      taskInfo = buildWorksheetTask(unit, lesson, videoContext);
    } else if (taskName === "blooket") {
      taskInfo = buildBlooketTask(unit, lesson, videoContext);
    } else {
      taskInfo = buildDrillsTask(unit, lesson, videoContext);
    }
  } catch (e) {
    console.error(`  Failed to build prompt: ${e.message}`);
    updateStatus(unit, lesson, REGISTRY_KEYS[taskName], "failed");
    process.exit(1);
  }

  // 3. Mark as running, write prompt, launch Codex
  updateStatus(unit, lesson, REGISTRY_KEYS[taskName], "running");

  let promptFile = null;
  let launchResult;
  try {
    promptFile = writeTempPromptFile(taskInfo.label, taskInfo.prompt, taskInfo.workingDir);
    launchResult = await launchCodexTask(taskInfo.label, promptFile, taskInfo.workingDir);
  } catch (e) {
    cleanupTempPromptFile(promptFile);
    console.error(`  Codex launch failed: ${e.message}`);
    updateStatus(unit, lesson, REGISTRY_KEYS[taskName], "failed");
    process.exit(1);
  }

  if (!launchResult.success) {
    console.error(`  Codex task failed: ${launchResult.error || "unknown error"}`);
    updateStatus(unit, lesson, REGISTRY_KEYS[taskName], "failed");
    process.exit(1);
  }

  // 4. Validate output
  let validation;
  if (taskName === "worksheet") {
    validation = validateWorksheetOutput(unit, lesson);
  } else if (taskName === "blooket") {
    validation = validateBlooketOutput(unit, lesson);
  } else {
    validation = validateDrillsOutput(unit, lesson);
  }

  // 5. Update registry and exit
  if (validation.ok) {
    updateStatus(unit, lesson, REGISTRY_KEYS[taskName], "done");
    console.log(`\n  ${taskInfo.label}: SUCCESS\n`);
    process.exit(0);
  } else {
    updateStatus(unit, lesson, REGISTRY_KEYS[taskName], "failed");
    console.error(`\n  ${taskInfo.label}: FAILED — ${validation.error}\n`);
    process.exit(1);
  }
}

main();
