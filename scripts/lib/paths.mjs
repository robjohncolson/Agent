/**
 * paths.mjs — Machine-aware path configuration for the lesson-prep pipeline.
 *
 * Auto-detects the current machine via os.userInfo().username and exports
 * all paths that scripts need. Import from here instead of hardcoding.
 */

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";

// ── Agent root (derived from this file's location — always correct) ──────────
const __filename = fileURLToPath(import.meta.url);
export const AGENT_ROOT = join(dirname(__filename), "..", "..");

// ── Machine profiles ─────────────────────────────────────────────────────────
const MACHINES = {
  ColsonR: {
    worksheetRepo:  "C:/Users/ColsonR/apstats-live-worksheet",
    drillerRepo:    "C:/Users/ColsonR/lrsl-driller",
    curriculumRepo: "C:/Users/ColsonR/curriculum_render",
    python:         "C:/Users/ColsonR/AppData/Local/Programs/Python/Python312/python.exe",
    ffmpegDir:      "C:/Users/ColsonR/ffmpeg/bin",
    miktexDir:      "C:/Program Files/MiKTeX/miktex/bin/x64",
    edgeProfile:    "C:\\Users\\ColsonR\\.edge-debug-profile",
  },
  rober: {
    worksheetRepo:  "C:/Users/rober/Downloads/Projects/school/follow-alongs",
    drillerRepo:    "C:/Users/rober/Downloads/Projects/school/lrsl-driller",
    curriculumRepo: "C:/Users/rober/Downloads/Projects/school/curriculum_render",
    python:         null,
    ffmpegDir:      null,
    miktexDir:      "C:/Users/rober/scoop/apps/miktex/current/texmfs/install/miktex/bin/x64",
    edgeProfile:    "C:\\Users\\rober\\.edge-debug-profile",
  },
};

const username = os.userInfo().username;
const machine = MACHINES[username];
if (!machine) {
  const known = Object.keys(MACHINES).join(", ");
  console.error(
    `[paths.mjs] Unknown user "${username}". Known: ${known}. ` +
    `Add a profile to scripts/lib/paths.mjs.`
  );
  process.exit(1);
}

// ── Executable helpers ───────────────────────────────────────────────────────

function resolveExecutable(hardcoded, binaryName) {
  if (hardcoded && existsSync(hardcoded)) return hardcoded;
  try {
    const cmd = process.platform === "win32"
      ? `where ${binaryName}`
      : `which ${binaryName}`;
    return execSync(cmd, { encoding: "utf-8" }).trim().split(/\r?\n/)[0];
  } catch {
    return binaryName;
  }
}

function resolveToolDir(hardcodedDir, binaryName) {
  if (hardcodedDir && existsSync(hardcodedDir)) return hardcodedDir;
  const resolved = resolveExecutable(null, binaryName);
  return resolved !== binaryName ? dirname(resolved) : "";
}

// ── Repository roots ─────────────────────────────────────────────────────────
export const WORKSHEET_REPO  = machine.worksheetRepo;
export const DRILLER_REPO    = machine.drillerRepo;
export const CURRICULUM_REPO = machine.curriculumRepo;

// Aliases (scripts use different names for the same repo)
export const CALENDAR_DIR = WORKSHEET_REPO;
export const CSV_BASE_DIR = WORKSHEET_REPO;

// ── Agent-internal paths ─────────────────────────────────────────────────────
export const CONFIG_DIR             = join(AGENT_ROOT, "config");
export const DRIVE_VIDEO_INDEX_PATH = join(CONFIG_DIR, "drive-video-index.json");

// ── Downstream repo sub-paths ────────────────────────────────────────────────
export const CARTRIDGES_DIR = join(DRILLER_REPO, "cartridges");
export const UNITS_JS_PATH  = join(CURRICULUM_REPO, "data", "units.js");

// ── Tool executables ─────────────────────────────────────────────────────────
export const PYTHON     = resolveExecutable(machine.python, "python");
export const FFMPEG_DIR = resolveToolDir(machine.ffmpegDir, "ffmpeg");
export const MIKTEX_DIR = resolveToolDir(machine.miktexDir, "pdflatex");

// ── Edge browser ─────────────────────────────────────────────────────────────
export const EDGE_PATH          = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
export const EDGE_DEBUG_PROFILE = machine.edgeProfile;

// ── Script paths (lesson-prep orchestrator) ──────────────────────────────────
const SCRIPTS_DIR = join(AGENT_ROOT, "scripts");

export const SCRIPTS = {
  whatsTomorrow:    join(SCRIPTS_DIR, "whats-tomorrow.mjs"),
  aistudioIngest:   join(SCRIPTS_DIR, "aistudio-ingest.mjs"),
  renderAnimations: join(SCRIPTS_DIR, "render-animations.mjs"),
  uploadAnimations: join(DRILLER_REPO, "scripts", "upload-animations.mjs"),
  uploadBlooket:    join(SCRIPTS_DIR, "upload-blooket.mjs"),
  postSchoology:    join(SCRIPTS_DIR, "post-to-schoology.mjs"),
  indexDriveVideos: join(SCRIPTS_DIR, "index-drive-videos.mjs"),
  lessonUrls:       join(SCRIPTS_DIR, "lesson-urls.mjs"),
};

// ── Working directories ──────────────────────────────────────────────────────
export const WORKING_DIRS = {
  worksheet: WORKSHEET_REPO,
  driller:   DRILLER_REPO,
};

// ── Downstream repos for commit/push ─────────────────────────────────────────
export const DOWNSTREAM_REPOS = [
  {
    name: "apstats-live-worksheet",
    path: WORKSHEET_REPO,
    patterns: [
      "u*_lesson*_live.html",
      "u*_l*_blooket.csv",
      "ai-grading-prompts-*.js",
    ],
  },
  {
    name: "lrsl-driller",
    path: DRILLER_REPO,
    patterns: [
      "animations/apstat_*.py",
      "cartridges/*/manifest.json",
      "cartridges/*/generator.js",
      "cartridges/*/grading-rules.js",
    ],
  },
];
