#!/usr/bin/env node
/**
 * post-pipeline-commit.mjs — Commit and push all 3 repos after a pipeline run.
 *
 * Checks Agent, apstats-live-worksheet, and lrsl-driller for uncommitted changes,
 * commits each with a standard message, and pushes to origin.
 *
 * Usage:
 *   node scripts/post-pipeline-commit.mjs --unit 7 --lesson 7
 *   node scripts/post-pipeline-commit.mjs --unit 7 --lesson 7 --dry-run
 */

import { execSync } from "node:child_process";
import { AGENT_ROOT, WORKSHEET_REPO, DRILLER_REPO } from "./lib/paths.mjs";

const REPOS = [
  {
    name: "Agent",
    path: AGENT_ROOT,
    addPatterns: ["state/lesson-registry.json", "state/work-queue.json", "config/"],
  },
  {
    name: "apstats-live-worksheet",
    path: WORKSHEET_REPO,
    addPatterns: ["u*_lesson*_live.html", "u*_l*_blooket.csv", "ai-grading-prompts-*.js", "roadmap-data.json"],
  },
  {
    name: "lrsl-driller",
    path: DRILLER_REPO,
    addPatterns: ["cartridges/", "animations/"],
  },
];

function parseArgs(argv) {
  const args = argv.slice(2);
  let unit = null;
  let lesson = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--unit" || arg === "-u") unit = parseInt(args[++i], 10);
    else if (arg === "--lesson" || arg === "-l") lesson = parseInt(args[++i], 10);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/post-pipeline-commit.mjs --unit U --lesson L [--dry-run]");
      process.exit(0);
    }
  }

  if (!unit || !lesson) {
    console.error("Error: --unit and --lesson are required.");
    process.exit(1);
  }

  return { unit, lesson, dryRun };
}

function run(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: "utf-8", timeout: 30000 }).trim();
}

function processRepo(repo, commitMsg, dryRun) {
  const status = run("git status -s", repo.path);
  if (!status) {
    console.log(`  ${repo.name}: clean`);
    return { name: repo.name, action: "clean" };
  }

  console.log(`  ${repo.name}: has changes`);

  // Stage matching patterns
  for (const pattern of repo.addPatterns) {
    try {
      run(`git add ${pattern}`, repo.path);
    } catch { /* pattern may not match */ }
  }

  const staged = run("git diff --cached --name-only", repo.path);
  if (!staged) {
    console.log(`  ${repo.name}: no matching files staged`);
    return { name: repo.name, action: "nothing-staged" };
  }

  const fileCount = staged.split("\n").filter(Boolean).length;
  console.log(`  ${repo.name}: ${fileCount} file(s) staged`);

  if (dryRun) {
    console.log(`  ${repo.name}: would commit and push (dry run)`);
    // Unstage
    try { run("git reset HEAD", repo.path); } catch { /* ok */ }
    return { name: repo.name, action: "dry-run", files: fileCount };
  }

  // Commit
  const commitOutput = run(`git commit -m "${commitMsg}"`, repo.path);
  const hashMatch = commitOutput.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
  const hash = hashMatch ? hashMatch[1] : "unknown";
  console.log(`  ${repo.name}: committed ${hash}`);

  // Push
  try {
    run("git push", repo.path);
    console.log(`  ${repo.name}: pushed`);
    return { name: repo.name, action: "pushed", hash };
  } catch (e) {
    console.error(`  ${repo.name}: push failed — ${e.message}`);
    return { name: repo.name, action: "committed", hash, pushError: e.message };
  }
}

function main() {
  const { unit, lesson, dryRun } = parseArgs(process.argv);
  const commitMsg = `feat: Topic ${unit}.${lesson} ingested + posted to Schoology B+E`;

  console.log(`\nPost-pipeline commit — Unit ${unit}, Lesson ${lesson}`);
  if (dryRun) console.log("(dry run)\n");
  else console.log();

  const results = [];
  for (const repo of REPOS) {
    results.push(processRepo(repo, commitMsg, dryRun));
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    const icon = r.action === "pushed" ? "+" : r.action === "committed" ? "~" : "-";
    console.log(`  [${icon}] ${r.name}: ${r.action}${r.hash ? ` (${r.hash})` : ""}`);
  }

  const anyFailed = results.some(r => r.pushError);
  if (anyFailed) process.exitCode = 1;
}

main();
