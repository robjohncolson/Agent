#!/usr/bin/env node
/**
 * schoology-verify.mjs - Verify lesson links exist in Schoology lesson folders.
 *
 * Usage:
 *   node scripts/schoology-verify.mjs --unit 6 --lesson 11
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";
import { buildExpectedLinks } from "./lib/schoology-heal.mjs";
import { COURSE_IDS, listItems, navigateToFolder } from "./lib/schoology-dom.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const REGISTRY_PATH = resolve(REPO_ROOT, "state", "lesson-registry.json");

function parseArgs() {
  const args = process.argv.slice(2);
  let unit = null;
  let lesson = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--unit" && args[i + 1]) unit = args[++i];
    else if (args[i] === "--lesson" && args[i + 1]) lesson = args[++i];
  }

  if (!unit || !lesson) {
    console.error("Usage: node scripts/schoology-verify.mjs --unit <U> --lesson <L>");
    process.exit(1);
  }

  return { unit, lesson };
}

function extractFolderId(folderUrl) {
  try {
    const u = new URL(folderUrl);
    return u.searchParams.get("f");
  } catch {
    return null;
  }
}

function extractCourseId(folderUrl) {
  try {
    const u = new URL(folderUrl);
    const match = u.pathname.match(/\/course\/(\d+)\/materials/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function normalizeTitle(value) {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function verifyFolder(page, courseId, folderId, expectedLinks) {
  await navigateToFolder(page, courseId, folderId);
  const items = await listItems(page);
  const itemNames = new Set(items.map((item) => normalizeTitle(item.name)));

  return expectedLinks.map(({ title }) => ({
    title,
    found: itemNames.has(normalizeTitle(title)),
  }));
}

function getFolderUrl(entry, periodKey) {
  if (periodKey === "B") {
    return entry.urls?.schoologyFolder || null;
  }
  return entry.urls?.schoologyFolderE || null;
}

function buildExpectedLinksForPeriod(entry, unit, lesson, periodKey) {
  const materials = entry.schoology?.[periodKey]?.materials;
  if (materials && Object.keys(materials).length > 0) {
    return Object.values(materials)
      .filter((material) => material && material.title && (material.targetUrl || material.href || material.status === "done"))
      .map((material) => ({ title: material.title }));
  }

  return buildExpectedLinks(unit, lesson, { blooketUrl: entry.urls?.blooket })
    .map(({ title }) => ({ title }));
}

async function main() {
  const { unit, lesson } = parseArgs();
  const key = `${unit}.${lesson}`;

  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch (err) {
    console.error(`Failed to read registry at ${REGISTRY_PATH}: ${err.message}`);
    process.exit(1);
  }

  const entry = registry[key];
  if (!entry) {
    console.error(`No registry entry found for lesson ${key}`);
    process.exit(1);
  }

  console.log(`Verifying Schoology links for ${key}`);
  console.log("");

  const periods = [
    { label: "Period B", periodKey: "B", courseIdKey: "B" },
    { label: "Period E", periodKey: "E", courseIdKey: "E" },
  ];

  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology" });

  let totalExpected = 0;
  let totalFound = 0;
  let anyMissing = false;

  for (const period of periods) {
    const folderUrl = getFolderUrl(entry, period.periodKey);
    const expectedLinks = buildExpectedLinksForPeriod(entry, unit, lesson, period.periodKey);

    if (!folderUrl) {
      console.log(`${period.label}: no folder URL - skipping`);
      console.log("");
      continue;
    }

    if (expectedLinks.length === 0) {
      console.log(`${period.label}: no expected links recorded - skipping`);
      console.log("");
      continue;
    }

    const folderId = extractFolderId(folderUrl);
    const courseId = extractCourseId(folderUrl) || COURSE_IDS[period.courseIdKey];

    if (!folderId) {
      console.log(`${period.label}: could not extract folder ID from URL - skipping`);
      console.log("");
      continue;
    }

    console.log(`${period.label} (folder ${folderId}):`);

    const results = await verifyFolder(page, courseId, folderId, expectedLinks);
    for (const { title, found } of results) {
      totalExpected++;
      if (found) {
        totalFound++;
        console.log(`  OK  ${title}`);
      } else {
        anyMissing = true;
        console.log(`  MISSING  ${title}`);
      }
    }

    console.log("");
  }

  await browser.close();

  const missing = totalExpected - totalFound;
  console.log(`Summary: ${totalFound}/${totalExpected} links verified, ${missing} missing`);

  process.exit(anyMissing ? 1 : 0);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
