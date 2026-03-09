#!/usr/bin/env node
// lesson-urls.mjs — Generate student-facing URLs for a lesson and copy to clipboard.
// Usage: node scripts/lesson-urls.mjs --unit 6 --lesson 4

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { CARTRIDGES_DIR } from "./lib/paths.mjs";
import { getLesson, computeUrls } from "./lib/lesson-registry.mjs";

// ── Cartridge mapping ──────────────────────────────────────────────────────────
const CARTRIDGE_MAP = {
  "5": "apstats-u5-sampling-dist",
  "6": "apstats-u6-inference-prop",
  "7": "apstats-u7-mean-ci",
  // extend as new cartridges are added
};

// ── Arg parsing ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  let unit = null;
  let lesson = null;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--unit" || args[i] === "-u") && args[i + 1]) {
      unit = parseInt(args[++i], 10);
    } else if ((args[i] === "--lesson" || args[i] === "-l") && args[i + 1]) {
      lesson = parseInt(args[++i], 10);
    }
  }

  if (!unit || !lesson) {
    console.error("Usage: node scripts/lesson-urls.mjs --unit <U> --lesson <L>");
    console.error("  -u, --unit    Unit number  (required)");
    console.error("  -l, --lesson  Lesson number (required)");
    process.exit(1);
  }

  return { unit, lesson };
}

// ── Drill deep-link detection ──────────────────────────────────────────────────
// Reads the cartridge manifest and finds the first mode whose name starts with
// the pattern "<unit>.<lesson>" (e.g. "6.4").
function findFirstDrillMode(unit, lesson) {
  const cartridgeId = CARTRIDGE_MAP[String(unit)];
  if (!cartridgeId) {
    return { cartridgeId: null, modeId: null };
  }

  const manifestPath = join(
    CARTRIDGES_DIR,
    cartridgeId,
    "manifest.json"
  );

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return { cartridgeId, modeId: null };
  }

  const prefix = `${unit}.${lesson}`;
  const modes = manifest.modes || [];

  // Primary: mode name starts with "<unit>.<lesson>" (e.g. "6.4a: ...")
  const match = modes.find((m) => m.name && m.name.startsWith(prefix));

  if (match) {
    return { cartridgeId, modeId: match.id };
  }

  return { cartridgeId, modeId: null };
}

// ── Main ───────────────────────────────────────────────────────────────────────
const { unit, lesson } = parseArgs(process.argv);
const computedUrls = computeUrls(unit, lesson);

// 1. Worksheet
const worksheetUrl = computedUrls.worksheet ||
  `https://robjohncolson.github.io/apstats-live-worksheet/u${unit}_lesson${lesson}_live.html`;

// 2. Drills
let drillsUrl;
const { cartridgeId, modeId } = findFirstDrillMode(unit, lesson);
if (cartridgeId && modeId) {
  drillsUrl =
    `https://lrsl-driller.vercel.app/platform/app.html?c=${cartridgeId}&level=${modeId}`;
} else if (cartridgeId) {
  drillsUrl =
    `https://lrsl-driller.vercel.app/platform/app.html?c=${cartridgeId}  [mode not auto-detected]`;
} else {
  drillsUrl = computedUrls.drills || "[no cartridge mapped for unit " + unit + "]";
}

// 3. Quiz (previous lesson)
let quizUrl;
if (lesson > 1) {
  quizUrl = computedUrls.quiz ||
    `https://robjohncolson.github.io/curriculum_render/?u=${unit}&l=${lesson - 1}`;
} else {
  quizUrl = "[no quiz — lesson 1 has no previous lesson]";
}

// 4. Blooket
// Check registry for Blooket URL
const registryEntry = getLesson(unit, lesson);
const blooketUrl = registryEntry?.urls?.blooket
  || "[upload CSV to blooket.com and paste URL here]";

// ── Format output ──────────────────────────────────────────────────────────────
const output = `=== Lesson ${unit}.${lesson} URLs ===

Worksheet:  ${worksheetUrl}
Drills:     ${drillsUrl}
Quiz:       ${quizUrl}
Blooket:    ${blooketUrl}
`;

// Print to stdout
process.stdout.write(output);

// Copy to clipboard on Windows via clip.exe
try {
  execSync("clip.exe", { input: output });
  console.log("\n(Copied to clipboard)");
} catch {
  console.error("\n(Could not copy to clipboard — clip.exe not available)");
}
