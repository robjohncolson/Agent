#!/usr/bin/env node
// render-animations.mjs — Render Manim animation .py files for a given unit+lesson.
// Usage: node scripts/render-animations.mjs --unit 6 --lesson 5
// Optional: --quality l (low/480p, default), --quality m (medium/720p), --quality h (high/1080p)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, basename } from "node:path";
import { PYTHON, FFMPEG_DIR, MIKTEX_DIR, DRILLER_REPO } from "./lib/paths.mjs";

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_REPO = DRILLER_REPO;

const QUALITY_MAP = {
  l: { flag: "-ql", label: "480p15" },
  m: { flag: "-qm", label: "720p30" },
  h: { flag: "-qh", label: "1080p60" },
};

// ── Arg parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  let unit = null;
  let lesson = null;
  let quality = "l";
  let repo = DEFAULT_REPO;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--unit" || args[i] === "-u") && args[i + 1]) {
      unit = parseInt(args[++i], 10);
    } else if ((args[i] === "--lesson" || args[i] === "-l") && args[i + 1]) {
      lesson = parseInt(args[++i], 10);
    } else if ((args[i] === "--quality" || args[i] === "-q") && args[i + 1]) {
      quality = args[++i];
    } else if (args[i] === "--repo" && args[i + 1]) {
      repo = args[++i];
    }
  }

  if (!unit || !lesson) {
    console.error("Usage: node scripts/render-animations.mjs --unit <U> --lesson <L>");
    console.error("  -u, --unit     Unit number   (required)");
    console.error("  -l, --lesson   Lesson number (required)");
    console.error("  -q, --quality  Render quality: l (default), m, h");
    console.error("  --repo         lrsl-driller repo path (default: " + DEFAULT_REPO + ")");
    process.exit(1);
  }

  if (!QUALITY_MAP[quality]) {
    console.error(`Invalid quality "${quality}". Use l, m, or h.`);
    process.exit(1);
  }

  return { unit, lesson, quality, repo };
}

// ── Find animation files ─────────────────────────────────────────────────────
function findAnimationFiles(repo, unit, lesson) {
  const animDir = join(repo, "animations");
  const prefix = `apstat_${unit}${lesson}_`;

  let files;
  try {
    files = readdirSync(animDir);
  } catch (err) {
    console.error(`Could not read animations directory: ${animDir}`);
    console.error(err.message);
    process.exit(1);
  }

  return files
    .filter((f) => f.startsWith(prefix) && f.endsWith(".py"))
    .sort()
    .map((f) => join(animDir, f));
}

// ── Render a single file ─────────────────────────────────────────────────────
// Pre-render lint for likely LaTeX-dependent constructs
function lintAnimationFile(filepath) {
  const contents = readFileSync(filepath, "utf-8");
  const lines = contents.split(/\r?\n/);
  const warnings = [];
  const rules = [
    {
      pattern: /\bMathTex\s*\(/,
      message: "MathTex() usage - consider Text() with Unicode",
    },
    {
      pattern: /\bTex\s*\(/,
      message: "Tex() usage - consider Text() with Unicode",
    },
    {
      pattern: /NumberLine\(.*include_numbers\s*=\s*True/,
      message: "NumberLine(include_numbers=True) usage - labels may require LaTeX",
    },
    {
      pattern: /numbers_to_include/,
      message: "numbers_to_include usage - axis number rendering may require LaTeX",
    },
  ];

  for (const [index, line] of lines.entries()) {
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        warnings.push(`line ${index + 1}: ${rule.message}`);
      }
    }
  }

  return warnings;
}

// Render a single file
function renderFile(filepath, qualityFlag, repo, env) {
  return new Promise((resolve) => {
    const proc = spawn(
      PYTHON,
      ["-m", "manim", "render", qualityFlag, filepath],
      {
        cwd: repo,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      resolve({ filepath, code, stdout, stderr });
    });

    proc.on("error", (err) => {
      resolve({ filepath, code: -1, stdout: "", stderr: err.message });
    });
  });
}

// ── Find rendered output files ───────────────────────────────────────────────
function findRenderedVideos(repo, pyFile, qualityLabel) {
  // Manim outputs to media/videos/<stem>/<qualityLabel>/<SceneName>.mp4
  const stem = basename(pyFile, ".py");
  const videoDir = join(repo, "media", "videos", stem, qualityLabel);

  let files;
  try {
    files = readdirSync(videoDir);
  } catch {
    return [];
  }

  return files
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => {
      const fullPath = join(videoDir, f);
      let sizeKB = 0;
      try {
        sizeKB = Math.round(statSync(fullPath).size / 1024);
      } catch {
        // ignore
      }
      const relPath = `media/videos/${stem}/${qualityLabel}/${f}`;
      return { name: f, sizeKB, relPath };
    });
}

// ── Format file size ─────────────────────────────────────────────────────────
function formatSize(kb) {
  if (kb >= 1024) {
    return `${(kb / 1024).toFixed(1)} MB`;
  }
  return `${kb} KB`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { unit, lesson, quality, repo } = parseArgs(process.argv);
  const qualityInfo = QUALITY_MAP[quality];

  console.log(`Rendering animations for Unit ${unit} Lesson ${lesson} (${qualityInfo.label})`);
  console.log(`Repo: ${repo}\n`);

  // Find animation files
  const pyFiles = findAnimationFiles(repo, unit, lesson);

  if (pyFiles.length === 0) {
    console.log(`No animation files found matching apstat_${unit}${lesson}_*.py`);
    process.exit(0);
  }

  console.log(`Found ${pyFiles.length} animation file(s):\n`);

  // Set up environment with ffmpeg and MiKTeX on PATH
  const env = { ...process.env };
  const pathSep = process.platform === "win32" ? ";" : ":";
  env.PATH = FFMPEG_DIR + pathSep + MIKTEX_DIR + pathSep + (env.PATH || "");

  // Render files sequentially to avoid TeX cache lock conflicts on Windows
  // (parallel renders for different lessons fight over media/Tex/ — see spec item #7)
  let successCount = 0;
  let failCount = 0;

  for (const pyFile of pyFiles) {
    const name = basename(pyFile);
    console.log(`Rendering ${name} ...`);

    const warnings = lintAnimationFile(pyFile);
    for (const warning of warnings) {
      console.warn(`  ⚠ ${warning}`);
    }

    const result = await renderFile(pyFile, qualityInfo.flag, repo, env);

    if (result.code !== 0) {
      failCount++;
      console.error(`  FAIL ${name} (exit code ${result.code})`);
      if (result.stderr) {
        // Print last few lines of stderr for context
        const lines = result.stderr.trim().split("\n");
        const tail = lines.slice(-5).join("\n");
        console.error(`  ${tail}\n`);
      }
      continue;
    }

    // Find rendered output .mp4 files
    const videos = findRenderedVideos(repo, pyFile, qualityInfo.label);

    if (videos.length === 0) {
      console.log(`  Rendered but no .mp4 found in expected output directory.\n`);
      successCount++;
      continue;
    }

    for (const v of videos) {
      console.log(`  \u2713 ${v.name} (${formatSize(v.sizeKB)}) \u2192 ${v.relPath}`);
    }
    console.log();
    successCount++;
  }

  // Summary
  console.log(`\nDone. ${successCount} succeeded, ${failCount} failed out of ${pyFiles.length} file(s).`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main();
