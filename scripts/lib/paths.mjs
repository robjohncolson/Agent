/**
 * paths.mjs — Machine-aware path configuration for the lesson-prep pipeline.
 *
 * Auto-detects the current machine via os.userInfo().username and exports
 * all paths that scripts need. Import from here instead of hardcoding.
 */

import { existsSync, readFileSync } from "node:fs";
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

// ── Registry-based machine resolution ────────────────────────────────────────

function readFromRegistry() {
  const usernameProfile = MACHINES[os.userInfo().username] ?? {};
  // Determine machine ID: env override takes precedence, then .machine-id file
  let machineId;
  if (process.env.AGENT_MACHINE) {
    machineId = process.env.AGENT_MACHINE.trim();
  } else {
    const machineIdPath = join(AGENT_ROOT, ".machine-id");
    machineId = readFileSync(machineIdPath, "utf-8").trim();
  }

  // Read machine-paths/<machineId>.json
  const machinePathsFile = join(AGENT_ROOT, "registry", "machine-paths", `${machineId}.json`);
  const machinePaths = JSON.parse(readFileSync(machinePathsFile, "utf-8"));

  // Read machines.json for per-machine metadata (python path, etc.)
  const machinesFile = join(AGENT_ROOT, "registry", "machines.json");
  const machinesRegistry = JSON.parse(readFileSync(machinesFile, "utf-8"));
  const machineRecord = machinesRegistry[machineId] ?? null;

  // Resolve python executable: registry stores the directory, append binary name
  let pythonExe = null;
  if (machineRecord?.python) {
    const suffix = process.platform === "win32" ? "python.exe" : "python3";
    pythonExe = join(machineRecord.python, suffix);
  }

  return {
    worksheetRepo:  machinePaths.repos["apstats-live-worksheet"],
    drillerRepo:    machinePaths.repos["lrsl-driller"],
    curriculumRepo: machinePaths.repos["curriculum-render"],
    python:         pythonExe ?? usernameProfile.python ?? null,
    ffmpegDir:      machineRecord?.ffmpegDir ?? machineRecord?.ffmpeg_dir ?? usernameProfile.ffmpegDir ?? null,
    miktexDir:      machineRecord?.miktexDir ?? machineRecord?.miktex_dir ?? usernameProfile.miktexDir ?? null,
    edgeProfile:    join(machinePaths.base_path, ".edge-debug-profile"),
  };
}

// ── Machine resolution (registry first, hardcoded MACHINES as fallback) ──────

let machine;
try {
  machine = readFromRegistry();
} catch {
  const username = os.userInfo().username;
  machine = MACHINES[username];
  if (!machine) {
    const known = Object.keys(MACHINES).join(", ");
    console.error(
      `[paths.mjs] Unknown user "${username}". Known: ${known}. ` +
      `Add a profile or configure registry.`
    );
    process.exit(1);
  }
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
  uploadAnimations: join(SCRIPTS_DIR, "upload-animations.mjs"),
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
    name: "Agent",
    path: AGENT_ROOT,
    patterns: [
      "state/lesson-registry.json",
      "state/work-queue.json",
      "state/blooket-uploads.json",
      "state/animation-uploads.json",
      "config/",
    ],
  },
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
