#!/usr/bin/env node
/**
 * backfill-content-hashes.mjs - One-time migration to add contentHash
 * to all existing materials in the lesson registry.
 *
 * Idempotent: re-running overwrites hashes with the same values.
 *
 * Usage:
 *   node scripts/backfill-content-hashes.mjs
 *   node scripts/backfill-content-hashes.mjs --dry-run
 */

import { loadRegistry, saveRegistry } from "./lib/lesson-registry.mjs";
import { computeContentHash, normalizeTitle } from "./lib/content-hash.mjs";

const dryRun = process.argv.includes("--dry-run");

const registry = loadRegistry();
let totalHashed = 0;
const perPeriod = { B: 0, E: 0 };

for (const entry of Object.values(registry)) {
  const { unit, lesson } = entry ?? {};
  if (!unit || !lesson) continue;

  for (const period of ["B", "E"]) {
    const schoologyState = entry.schoology?.[period];
    if (!schoologyState?.materials) continue;

    for (const [type, material] of Object.entries(schoologyState.materials)) {
      if (type === "videos") {
        if (!Array.isArray(material)) continue;

        for (let index = 0; index < material.length; index += 1) {
          const video = material[index];
          if (!video || typeof video !== "object") continue;

          const disambiguator =
            video.targetUrl ||
            normalizeTitle(video.title) ||
            `untitled-${index}`;

          video.contentHash = computeContentHash(unit, lesson, "video", disambiguator);
          totalHashed += 1;
          perPeriod[period] += 1;
        }

        continue;
      }

      if (!material || typeof material !== "object") continue;

      material.contentHash = computeContentHash(unit, lesson, type);
      totalHashed += 1;
      perPeriod[period] += 1;
    }
  }
}

if (!dryRun) {
  saveRegistry(registry);
  console.log("[backfill] Saved registry with content hashes");
} else {
  console.log("[dry-run] Would save registry (no changes written)");
}

console.log(
  `[backfill] Hashed ${totalHashed} materials (B: ${perPeriod.B}, E: ${perPeriod.E})`
);
