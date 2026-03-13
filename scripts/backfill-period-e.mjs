#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_ROOT } from "./lib/paths.mjs";

const REGISTRY_PATH = join(AGENT_ROOT, "state", "lesson-registry.json");
const POST_SCRIPT = join(AGENT_ROOT, "scripts", "post-to-schoology.mjs");
const PERIOD_E_COURSE_ID = "7945275798";
const PAUSE_MS = 5000;

function printUsage() {
  console.log(`Usage: node scripts/backfill-period-e.mjs [--dry-run] [--unit N]

Options:
  --dry-run   List lessons only
  --unit N    Filter to a specific unit
  --help, -h  Show this help
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let dryRun = false;
  let unitFilter = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--unit") {
      unitFilter = Number(args[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  if (unitFilter !== null && Number.isNaN(unitFilter)) {
    console.error("Invalid unit number for --unit");
    process.exit(1);
  }

  return { dryRun, unitFilter };
}

function compareLessonKeys(a, b) {
  const [aUnit, aLesson] = a.split(".").map(Number);
  const [bUnit, bLesson] = b.split(".").map(Number);
  return aUnit !== bUnit ? aUnit - bUnit : aLesson - bLesson;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadRegistry() {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
}

function buildWorkList(registry, unitFilter) {
  const workList = [];

  for (const key of Object.keys(registry).sort(compareLessonKeys)) {
    const [unit, lesson] = key.split(".");
    if (unitFilter !== null && Number(unit) !== unitFilter) {
      continue;
    }

    const entry = registry[key];
    if (entry?.urls?.schoologyFolderE) {
      continue;
    }
    if (!entry?.urls?.schoologyFolder) {
      continue;
    }

    workList.push({
      key,
      unit: Number(unit),
      lesson: Number(lesson),
    });
  }

  return workList;
}

function printWorkList(workList) {
  if (workList.length === 0) {
    console.log("No lessons need Period E Schoology backfill.");
    return;
  }

  console.log(`${workList.length} lesson(s) need Period E Schoology backfill:\n`);
  for (const item of workList) {
    console.log(`  ${item.key}`);
  }
}

function buildCommand(item) {
  return `node "${POST_SCRIPT}" --unit ${item.unit} --lesson ${item.lesson} --auto-urls --with-videos --course ${PERIOD_E_COURSE_ID} --no-prompt`;
}

async function main() {
  const { dryRun, unitFilter } = parseArgs(process.argv);
  const registry = loadRegistry();
  const workList = buildWorkList(registry, unitFilter);

  printWorkList(workList);

  if (dryRun || workList.length === 0) {
    if (dryRun) {
      console.log("\nDry run complete. No changes made.");
    }
    return;
  }

  let succeeded = 0;
  let failed = 0;
  const failedLessons = [];

  for (let index = 0; index < workList.length; index++) {
    const item = workList[index];
    console.log(`\n[${index + 1}/${workList.length}] Posting Period E materials for ${item.key}...`);

    try {
      execSync(buildCommand(item), {
        cwd: AGENT_ROOT,
        stdio: "inherit",
      });
      succeeded += 1;
    } catch (error) {
      failed += 1;
      failedLessons.push(item.key);
      const exitCode = Number.isInteger(error?.status) ? ` (exit ${error.status})` : "";
      console.error(`  [ERROR] Failed to post Period E materials for ${item.key}${exitCode}`);
    }

    if (index < workList.length - 1) {
      await sleep(PAUSE_MS);
    }
  }

  console.log("\n=== Period E Backfill Summary ===");
  console.log(`Processed: ${workList.length}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  if (failedLessons.length > 0) {
    console.log(`Failed lessons: ${failedLessons.join(", ")}`);
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
