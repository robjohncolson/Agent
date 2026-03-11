#!/usr/bin/env node
/**
 * commit-push.mjs — Standalone CLI worker that commits and pushes changes
 * in downstream repos.
 *
 * Extracted from commitAndPushRepos() in scripts/lesson-prep.mjs.
 *
 * Usage:
 *   node scripts/workers/commit-push.mjs --unit 6 --lesson 5
 *   node scripts/workers/commit-push.mjs --unit 6 --lesson 5 --auto_push
 */

import { execSync } from "node:child_process";
import { DOWNSTREAM_REPOS } from "../lib/paths.mjs";

// ── Parse CLI args ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { unit: null, lesson: null, autoPush: false };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--unit":
        args.unit = argv[++i];
        break;
      case "--lesson":
        args.lesson = argv[++i];
        break;
      case "--auto_push":
        args.autoPush = true;
        break;
    }
  }
  if (!args.unit || !args.lesson) {
    console.error("Usage: node commit-push.mjs --unit <N> --lesson <N> [--auto_push]");
    process.exit(1);
  }
  return args;
}

const { unit, lesson, autoPush } = parseArgs(process.argv);

// ── Commit and push each downstream repo ────────────────────────────────────

const repoResults = [];

for (const repo of DOWNSTREAM_REPOS) {
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

    if (autoPush) {
      try {
        execSync("git push", { cwd: repo.path, encoding: "utf-8", timeout: 30000 });
        console.log(`  ${repo.name}: pushed to origin`);
        repoResults.push({ name: repo.name, action: "pushed", hash });
      } catch (pushErr) {
        console.log(`  ${repo.name}: push failed: ${pushErr.message}`);
        repoResults.push({ name: repo.name, action: "committed", hash, pushError: pushErr.message });
      }
    } else {
      console.log(`  ${repo.name}: committed locally (use --auto_push to push)`);
      repoResults.push({ name: repo.name, action: "committed", hash });
    }
  } catch (e) {
    console.error(`  ${repo.name}: error: ${e.message}`);
    repoResults.push({ name: repo.name, action: "error", error: e.message });
  }
}

// ── Results summary ─────────────────────────────────────────────────────────

console.log("\n--- Commit/Push Summary ---");
for (const r of repoResults) {
  const detail = r.hash ? ` (${r.hash})` : "";
  console.log(`  ${r.name}: ${r.action}${detail}`);
}
console.log();

// Always exit 0 — commit failures are non-fatal for the pipeline
process.exit(0);
