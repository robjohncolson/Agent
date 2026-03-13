#!/usr/bin/env node
/**
 * delete-stale-drills.mjs — Delete the 2 remaining stale drill links from Schoology.
 *
 * Targets:
 *   6.11 B — 8286302261 "Topic 6.11 — Drills" (old, replaced by 8288418098)
 *   6.11 E — 8288287536 "Drills — 6.11"       (old, replaced by 8288418715)
 *
 * Usage:
 *   node scripts/delete-stale-drills.mjs          # dry-run (probe only)
 *   node scripts/delete-stale-drills.mjs --execute # actually delete
 */

import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";
import { deleteSchoologyLink } from "./lib/schoology-heal.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_ROOT } from "./lib/paths.mjs";

const REGISTRY_PATH = join(AGENT_ROOT, "state", "lesson-registry.json");
const DRY_RUN = !process.argv.includes("--execute");

const TARGETS = [
  {
    label: "6.11 Period B",
    linkId: "8286302261",
    folderUrl: "https://lynnschools.schoology.com/course/7945275782/materials?f=986588515",
    registryKey: "6.11",
    period: "B",
    replacedBy: "8288418098",
  },
  {
    label: "6.11 Period E",
    linkId: "8288287536",
    folderUrl: "https://lynnschools.schoology.com/course/7945275798/materials?f=986897040",
    registryKey: "6.11",
    period: "E",
    replacedBy: "8288418715",
  },
];

async function main() {
  if (DRY_RUN) {
    console.log("DRY RUN — will probe but not delete. Use --execute to delete.\n");
  }

  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology" });
  const results = [];

  for (const target of TARGETS) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Target: ${target.label} — Link ${target.linkId}`);
    console.log(`Folder: ${target.folderUrl}`);
    console.log(`Replaced by: ${target.replacedBy}`);
    console.log("─".repeat(60));

    // Navigate to the folder
    await page.goto(target.folderUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);

    // Verify the link exists
    const exists = await page.evaluate((id) => {
      const a = document.querySelector(`a[href*="/link/view/${id}"]`);
      return a ? a.textContent.trim() : null;
    }, target.linkId);

    if (!exists) {
      console.log(`  ✓ Link ${target.linkId} not found — already deleted`);
      results.push({ ...target, status: "already-gone" });
      continue;
    }

    console.log(`  Found: "${exists}"`);

    // Verify the replacement exists too
    const replacement = await page.evaluate((id) => {
      const a = document.querySelector(`a[href*="/link/view/${id}"]`);
      return a ? a.textContent.trim() : null;
    }, target.replacedBy);

    if (!replacement) {
      console.log(`  ⚠ Replacement ${target.replacedBy} NOT found — skipping deletion for safety`);
      results.push({ ...target, status: "skipped-no-replacement" });
      continue;
    }

    console.log(`  Replacement: "${replacement}" (${target.replacedBy})`);

    if (DRY_RUN) {
      console.log(`  [dry-run] Would delete ${target.linkId}`);
      results.push({ ...target, status: "dry-run" });
      continue;
    }

    // Delete
    console.log(`  Deleting ${target.linkId}...`);
    const result = await deleteSchoologyLink(page, target.linkId);

    if (result.deleted) {
      console.log(`  ✓ Deleted successfully`);
      results.push({ ...target, status: "deleted" });
    } else {
      console.log(`  ✗ Failed: ${result.reason}`);
      results.push({ ...target, status: "failed", reason: result.reason });
    }
  }

  // Summary
  console.log(`\n${"═".repeat(60)}`);
  console.log("Summary:");
  for (const r of results) {
    console.log(`  ${r.label}: ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
  }

  // Update registry if any deletions succeeded
  const deleted = results.filter(r => r.status === "deleted");
  if (deleted.length > 0) {
    console.log(`\nUpdating registry (${deleted.length} deletions)...`);
    const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

    for (const d of deleted) {
      const lesson = registry[d.registryKey];
      if (!lesson?.schoology?.[d.period]?.materials) continue;

      const materials = lesson.schoology[d.period].materials;
      // Find and remove the material with matching schoologyId
      for (const [key, mat] of Object.entries(materials)) {
        if (mat.schoologyId === d.linkId) {
          console.log(`  Removed ${d.period}.materials.${key} (${d.linkId})`);
          delete materials[key];
        } else if (Array.isArray(mat)) {
          // Handle arrays (like videos)
          const idx = mat.findIndex(m => m.schoologyId === d.linkId);
          if (idx >= 0) {
            mat.splice(idx, 1);
            console.log(`  Removed ${d.period}.materials.${key}[${idx}] (${d.linkId})`);
          }
        }
      }

      // If the old link was referenced as previousId in the replacement, clear it
      for (const mat of Object.values(materials)) {
        if (mat?.previousId === d.linkId) {
          mat.previousId = null;
          console.log(`  Cleared previousId reference in replacement material`);
        }
      }
    }

    writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf-8");
    console.log("Registry updated.");
  }
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
