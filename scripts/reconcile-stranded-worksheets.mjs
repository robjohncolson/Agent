#!/usr/bin/env node
/**
 * reconcile-stranded-worksheets.mjs
 *
 * Scan WORKSHEET_REPO for `u<U>_lesson<L|L-L|...>_live.html` and
 * `u<U>_l<L|L_L|...>_blooket.csv`, then upsert one registry entry per
 * (unit, lesson) tuple so end-of-year pacing data reflects every worksheet
 * actually shipped to students. Multi-lesson HTMLs produce one entry per
 * member lesson, all pointing to the same URL.
 *
 * Date inference (in priority order):
 *   1. `state/taught-date-overrides.json` (key "U.L" -> "YYYY-MM-DD")
 *   2. `config/topic-schedule.json` Period B (real scheduled date)
 *   3. Git first-commit date of the worksheet HTML (fallback for
 *      pre-schedule units like U3-U5 where every file shares the
 *      bulk-import commit date)
 * The registry entry records `dateSource` so reports can flag
 * git-fallback dates as low-confidence.
 *
 * Usage:
 *   node scripts/reconcile-stranded-worksheets.mjs            # preview
 *   node scripts/reconcile-stranded-worksheets.mjs --execute  # write
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AGENT_ROOT, WORKSHEET_REPO } from "./lib/paths.mjs";
import { loadRegistry, upsertLesson } from "./lib/lesson-registry.mjs";

const EXECUTE = process.argv.includes("--execute");
const GH_PAGES_BASE = "https://robjohncolson.github.io/apstats-live-worksheet";
const WORKSHEET_RE = /^u(\d+)_lesson([\d-]+)_live\.html$/;
const BLOOKET_RE   = /^u(\d+)_l([\d_-]+)_blooket\.csv$/;

const overridesPath = join(AGENT_ROOT, "state", "taught-date-overrides.json");
const overrides = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, "utf8"))
  : {};

const schedulePath = join(AGENT_ROOT, "config", "topic-schedule.json");
const scheduleRaw = existsSync(schedulePath)
  ? JSON.parse(readFileSync(schedulePath, "utf8"))
  : {};
const scheduleB = scheduleRaw.B || {};
const scheduleE = scheduleRaw.E || {};

function resolveDate(key) {
  if (overrides[key]) return { date: overrides[key], source: "override" };
  if (scheduleB[key]) return { date: scheduleB[key], source: "schedule-B" };
  return { date: null, source: "git-fallback" };
}

function parseLessons(token) {
  const parts = token.split(/[-_]/).map((s) => parseInt(s, 10)).filter(Number.isFinite);
  if (parts.length === 2) {
    const [lo, hi] = [...parts].sort((a, b) => a - b);
    const out = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
  }
  return parts;
}

function gitFirstCommitDate(file) {
  try {
    const out = execSync(
      `git log --diff-filter=A --follow --format=%aI -- "${file}"`,
      { cwd: WORKSHEET_REPO, encoding: "utf8" }
    ).trim().split("\n").filter(Boolean);
    return out[out.length - 1]?.slice(0, 10) || null;
  } catch {
    return null;
  }
}

const files = readdirSync(WORKSHEET_REPO);
const registry = loadRegistry();
const upserts = new Map();

for (const f of files) {
  const wm = f.match(WORKSHEET_RE);
  if (wm) {
    const unit = parseInt(wm[1], 10);
    const lessons = parseLessons(wm[2]);
    const date = gitFirstCommitDate(f);
    const url = `${GH_PAGES_BASE}/${f}`;
    for (const lesson of lessons) {
      const key = `${unit}.${lesson}`;
      const entry = upserts.get(key) || { unit, lesson };
      entry.worksheetUrl = url;
      const resolved = resolveDate(key);
      entry.taughtDate = resolved.date || date;
      entry.dateSource = resolved.source === "git-fallback" && date
        ? "git-fallback"
        : resolved.source;
      entry.taughtDateE = scheduleE[key] || null;
      upserts.set(key, entry);
    }
    continue;
  }
  const bm = f.match(BLOOKET_RE);
  if (bm) {
    const unit = parseInt(bm[1], 10);
    const lessons = parseLessons(bm[2]);
    for (const lesson of lessons) {
      const key = `${unit}.${lesson}`;
      const entry = upserts.get(key) || { unit, lesson };
      entry.hasBlooketCsv = true;
      upserts.set(key, entry);
    }
  }
}

const plan = [];
let added = 0, refreshed = 0, skipped = 0;

for (const [key, e] of [...upserts.entries()].sort((a, b) => {
  const [au, al] = a[0].split(".").map(Number);
  const [bu, bl] = b[0].split(".").map(Number);
  return au - bu || al - bl;
})) {
  const existing = registry[key];
  const isNew = !existing;
  const hasWorksheet = existing?.urls?.worksheet === e.worksheetUrl;
  const blooketCsvDone = existing?.status?.blooketCsv === "done";
  const wantBlooket = !!e.hasBlooketCsv;

  if (!isNew && hasWorksheet && (!wantBlooket || blooketCsvDone)) {
    skipped++;
    continue;
  }
  if (isNew) added++; else refreshed++;
  plan.push({ key, e, isNew });
}

console.log(`Found ${upserts.size} (unit,lesson) tuples on disk.`);
console.log(`  New entries to add:        ${added}`);
console.log(`  Existing entries to fill:  ${refreshed}`);
console.log(`  Already complete (skip):   ${skipped}\n`);

for (const { key, e, isNew } of plan) {
  const tag = isNew ? "+ NEW " : "~ FILL";
  const src = (e.dateSource || "?").padEnd(13);
  const dE = e.taughtDateE ? `  E=${e.taughtDateE}` : "";
  console.log(
    `${tag}  ${key.padEnd(6)}  B=${(e.taughtDate || "???").padEnd(10)}${dE}  src=${src}  ws=${e.worksheetUrl ? "y" : "-"}  bl=${e.hasBlooketCsv ? "y" : "-"}`
  );
}

if (!EXECUTE) {
  console.log("\n(preview only — pass --execute to write)");
  process.exit(0);
}

for (const { key, e } of plan) {
  const patch = {
    date: e.taughtDate || null,
    dateSource: e.dateSource || null,
    pacing: { B: e.taughtDate || null, E: e.taughtDateE || null },
    urls: {},
    status: {},
  };
  if (e.worksheetUrl) {
    patch.urls.worksheet = e.worksheetUrl;
    patch.status.worksheet = "done";
    patch.status.ingest = "done";
  }
  if (e.hasBlooketCsv) {
    patch.status.blooketCsv = "done";
  }
  upsertLesson(e.unit, e.lesson, patch);
}
console.log(`\nWrote ${plan.length} entries to ${join(AGENT_ROOT, "state", "lesson-registry.json")}.`);
console.log("Next: node scripts/build-roadmap-data.mjs && node scripts/sync-schedule-to-supabase.mjs --execute");
