#!/usr/bin/env node
/**
 * build-roadmap-data.mjs — Build roadmap-data.json from lesson registry + topic schedule.
 *
 * Reads state/lesson-registry.json and config/topic-schedule.json, produces:
 *   1. roadmap-data.json in the worksheet repo (for fetch at runtime)
 *   2. Injects BAKED_REGISTRY into ap_stats_roadmap.html (offline fallback)
 *
 * Usage:
 *   node scripts/build-roadmap-data.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { AGENT_ROOT, WORKSHEET_REPO } from "./lib/paths.mjs";

const REGISTRY_PATH = join(AGENT_ROOT, "state", "lesson-registry.json");
const SCHEDULE_PATH = join(AGENT_ROOT, "config", "topic-schedule.json");
const ROADMAP_JSON  = join(WORKSHEET_REPO, "roadmap-data.json");
const ROADMAP_HTML  = join(WORKSHEET_REPO, "ap_stats_roadmap.html");
const SQUARE_HTML   = join(WORKSHEET_REPO, "ap_stats_roadmap_square_mode.html");

// ── Read inputs ─────────────────────────────────────────────────────────────

const registryRaw = readFileSync(REGISTRY_PATH, "utf-8");
const registry = JSON.parse(registryRaw);
const schedule = JSON.parse(readFileSync(SCHEDULE_PATH, "utf-8"));

// ── Registry version (content hash) ─────────────────────────────────────────

const registryVersion = createHash("sha256")
  .update(registryRaw)
  .digest("hex")
  .slice(0, 12);

// ── Build lessons object ────────────────────────────────────────────────────

const lessons = {};

for (const [key, entry] of Object.entries(registry)) {
  if (!entry.urls) continue;

  const urls = {
    worksheet: entry.urls.worksheet || null,
    drills:    entry.urls.drills || null,
    quiz:      entry.urls.quiz || null,
    blooket:   entry.urls.blooket || null,
  };

  // Posted/verified per period
  const periodB = buildPeriodInfo(key, entry, "B", schedule);
  const periodE = buildPeriodInfo(key, entry, "E", schedule);

  // Status derivation
  const urlCount = [urls.worksheet, urls.drills, urls.quiz, urls.blooket]
    .filter(Boolean).length;
  const anyPosted = periodB.posted || periodE.posted;

  let status;
  if (urlCount === 4 && anyPosted) {
    status = "ready";
  } else if (urlCount > 0 || anyPosted) {
    status = "partial";
  } else {
    status = "pending";
  }

  lessons[key] = {
    topic: entry.topic,
    urls,
    status,
    periods: { B: periodB, E: periodE },
  };
}

function buildPeriodInfo(key, entry, period, sched) {
  const date = sched[period]?.[key] || null;

  // Schoology folder URL
  const folderUrl = period === "B"
    ? entry.urls.schoologyFolder || null
    : entry.urls.schoologyFolderE || null;

  // Posted: has materials in schoology data
  const materials = entry.schoology?.[period]?.materials;
  const materialKeys = materials
    ? Object.keys(materials).filter(k => k !== "videos")
    : [];
  const posted = materialKeys.length > 0;

  // Verified
  const verified = entry.schoology?.[period]?.verifiedAt != null;

  return { date, schoologyFolder: folderUrl, posted, verified };
}

// ── Write roadmap-data.json ─────────────────────────────────────────────────

const output = {
  generatedAt: new Date().toISOString(),
  registryVersion,
  lessons,
};

const outputJson = JSON.stringify(output, null, 2);
writeFileSync(ROADMAP_JSON, outputJson, "utf-8");
console.log(`Wrote roadmap-data.json (${Object.keys(lessons).length} lessons)`);

// ── Inject BAKED_REGISTRY into HTML ─────────────────────────────────────────

try {
  let html = readFileSync(ROADMAP_HTML, "utf-8");
  const pattern = /^(\s*)const BAKED_REGISTRY\s*=\s*\{[^;]*\};/m;

  if (pattern.test(html)) {
    html = html.replace(pattern, (match, indent) => {
      return `${indent}const BAKED_REGISTRY = ${outputJson};`;
    });
    writeFileSync(ROADMAP_HTML, html, "utf-8");
    console.log("Injected BAKED_REGISTRY into ap_stats_roadmap.html");
  } else {
    console.warn("WARNING: BAKED_REGISTRY placeholder not found in HTML — skipping injection");
  }
} catch (err) {
  console.warn(`WARNING: Could not inject BAKED_REGISTRY: ${err.message}`);
}

try {
  let html = readFileSync(SQUARE_HTML, "utf-8");
  const pattern = /^(\s*)const BAKED_REGISTRY\s*=\s*\{[^;]*\};/m;

  if (pattern.test(html)) {
    html = html.replace(pattern, (match, indent) => {
      return `${indent}const BAKED_REGISTRY = ${outputJson};`;
    });
    writeFileSync(SQUARE_HTML, html, "utf-8");
    console.log("Injected BAKED_REGISTRY into ap_stats_roadmap_square_mode.html");
  } else {
    console.warn("WARNING: BAKED_REGISTRY placeholder not found in HTML — skipping injection");
  }
} catch (err) {
  console.warn(`WARNING: Could not inject BAKED_REGISTRY: ${err.message}`);
}
