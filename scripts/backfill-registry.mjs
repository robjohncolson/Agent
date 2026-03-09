#!/usr/bin/env node
/**
 * backfill-registry.mjs — Fill null URL fields in the lesson registry
 * using computeUrls(), drills manifest lookups, and blooket-uploads.json.
 *
 * Usage:
 *   node scripts/backfill-registry.mjs              # apply to all units
 *   node scripts/backfill-registry.mjs --unit 6     # limit to unit 6
 *   node scripts/backfill-registry.mjs --dry-run    # preview only
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  loadRegistry,
  computeUrls,
  upsertLesson,
} from "./lib/lesson-registry.mjs";
import { AGENT_ROOT } from "./lib/paths.mjs";

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const unitIdx = args.indexOf("--unit");
const filterUnit = unitIdx !== -1 ? Number(args[unitIdx + 1]) : null;

// ── Load blooket uploads map ─────────────────────────────────────────────────
const BLOOKET_PATH = join(AGENT_ROOT, "state", "blooket-uploads.json");
let blooketUploads = [];
try {
  blooketUploads = JSON.parse(readFileSync(BLOOKET_PATH, "utf8"));
} catch {
  /* no uploads file */
}

// Build map: "unit.lesson" → most recent Blooket URL
const blooketMap = new Map();
for (const entry of blooketUploads) {
  if (entry.unit == null || entry.lesson == null || !entry.url) continue;
  const key = `${entry.unit}.${entry.lesson}`;
  const existing = blooketMap.get(key);
  if (!existing || new Date(entry.createdAt) > new Date(existing.createdAt)) {
    blooketMap.set(key, entry);
  }
}

// ── Special-case worksheet URLs ──────────────────────────────────────────────
const WORKSHEET_OVERRIDES = {
  "6.1":
    "https://robjohncolson.github.io/apstats-live-worksheet/u6_lesson1-2_live.html",
  "6.2":
    "https://robjohncolson.github.io/apstats-live-worksheet/u6_lesson1-2_live.html",
};

// ── Main loop ────────────────────────────────────────────────────────────────
const registry = loadRegistry();
let updated = 0;

for (const [key, entry] of Object.entries(registry)) {
  if (filterUnit != null && entry.unit !== filterUnit) continue;

  const urls = entry.urls || {};
  const status = entry.status || {};

  const computed = computeUrls(entry.unit, entry.lesson);

  // Apply worksheet overrides (e.g. combined 6.1/6.2 worksheet)
  if (WORKSHEET_OVERRIDES[key]) {
    computed.worksheet = WORKSHEET_OVERRIDES[key];
  }

  // Blooket lookup
  const blooketEntry = blooketMap.get(key);
  const blooketUrl = blooketEntry ? blooketEntry.url : null;

  // Build patch — fill null URLs and promote stale statuses to "done"
  const urlPatch = {};
  const statusPatch = {};
  const changes = [];

  // Worksheet: fill URL if null, promote status if URL exists but status isn't "done"
  if (urls.worksheet == null && computed.worksheet) {
    urlPatch.worksheet = computed.worksheet;
    statusPatch.worksheet = "done";
    changes.push(`worksheet → ${computed.worksheet}`);
  } else if (urls.worksheet && status.worksheet !== "done") {
    statusPatch.worksheet = "done";
    changes.push(`worksheet status → done`);
  }

  // Drills: same pattern
  if (urls.drills == null && computed.drills) {
    urlPatch.drills = computed.drills;
    statusPatch.drills = "done";
    changes.push(`drills → (set)`);
  } else if (urls.drills && status.drills !== "done") {
    statusPatch.drills = "done";
    changes.push(`drills status → done`);
  }

  // Quiz: no status key, just fill URL
  if (urls.quiz == null && computed.quiz) {
    urlPatch.quiz = computed.quiz;
    changes.push(`quiz → ${computed.quiz}`);
  }

  // Blooket: fill URL if null, promote status if URL exists
  if (urls.blooket == null && blooketUrl) {
    urlPatch.blooket = blooketUrl;
    statusPatch.blooketCsv = "done";
    statusPatch.blooketUpload = "done";
    changes.push(`blooket → ${blooketUrl}`);
  } else if (urls.blooket && status.blooketUpload !== "done") {
    statusPatch.blooketCsv = "done";
    statusPatch.blooketUpload = "done";
    changes.push(`blooket status → done`);
  }

  if (changes.length === 0) continue;

  console.log(`${dryRun ? "[DRY RUN] " : ""}${key}: ${changes.join(", ")}`);

  if (!dryRun) {
    upsertLesson(entry.unit, entry.lesson, {
      urls: urlPatch,
      status: statusPatch,
    });
  }

  updated++;
}

console.log(`\n${dryRun ? "[DRY RUN] " : ""}Updated ${updated} entries.`);

// ── Run export ───────────────────────────────────────────────────────────────
if (!dryRun && updated > 0) {
  console.log("\nRunning export-registry.mjs...");
  execSync("node scripts/export-registry.mjs", {
    cwd: AGENT_ROOT,
    stdio: "inherit",
  });
}
