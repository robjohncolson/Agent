#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cmdMoveFolder } from "./lib/schoology-commands-move.mjs";
import {
  navigateToFolder,
  listItems,
  findFolderByName,
  clickAddMaterials,
  clickAddFolder,
  clickAddFileLink,
  clickLinkOption,
  waitForPopup,
  fillFolderForm,
  fillLinkForm,
  submitPopup,
  sleep,
} from "./lib/schoology-dom.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const REGISTRY_PATH = resolve(REPO_ROOT, "state", "lesson-registry.json");

let chromium;
let connectCDP;

const LINK_TYPES = [
  { key: "worksheet", title: "Live Worksheet" },
  { key: "drills", title: "Drills" },
  { key: "quiz", title: "Quiz" },
  { key: "blooket", title: "Blooket" },
];

function printUsage() {
  console.error("Usage: node scripts/schoology-backfill.mjs <plan.json>");
}

function readJson(jsonPath) {
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}

function stepNumber(action, index) {
  return Number.isInteger(action?.step) ? action.step : index + 1;
}

function stepName(action) {
  if (action?.type === "post-links") {
    return action.folder || "(unnamed)";
  }
  return action?.name || "(unnamed)";
}

function summarizeAvailableFolders(items) {
  const folders = items.filter((item) => item.type === "folder").map((item) => item.name);
  return folders.length > 0 ? folders.join(", ") : "(none)";
}

async function navigateToRef(page, courseId, ref = null) {
  if (ref == null || ref === "") {
    await navigateToFolder(page, courseId);
    return null;
  }

  const normalized = String(ref);
  if (/^\d+$/.test(normalized)) {
    await navigateToFolder(page, courseId, normalized);
    return normalized;
  }

  return navigatePath(page, courseId, [normalized]);
}

async function navigatePath(page, courseId, pathSegments = []) {
  let currentFolderId = null;
  await navigateToFolder(page, courseId);

  for (const rawSegment of pathSegments) {
    const segment = String(rawSegment);

    if (/^\d+$/.test(segment)) {
      currentFolderId = segment;
      await navigateToFolder(page, courseId, currentFolderId);
      continue;
    }

    const folder = await findFolderByName(page, segment);
    if (!folder?.id) {
      const items = await listItems(page);
      throw new Error(
        `Could not find folder "${segment}". Available here: ${summarizeAvailableFolders(items)}`
      );
    }

    currentFolderId = String(folder.id);
    await navigateToFolder(page, courseId, currentFolderId);
  }

  return currentFolderId;
}

async function navigateToCreateParent(page, courseId, action) {
  const parentPath = Array.isArray(action?.parentPath) ? action.parentPath : null;

  if (parentPath && parentPath.length > 0) {
    return navigatePath(page, courseId, parentPath);
  }

  if (action?.in == null || action.in === "") {
    await navigateToFolder(page, courseId);
    return null;
  }

  return navigatePath(page, courseId, [action.in]);
}

async function navigateToPostTarget(page, courseId, action) {
  const parentPath = Array.isArray(action?.parentPath) ? action.parentPath : null;

  if (parentPath && parentPath.length > 0) {
    return navigatePath(page, courseId, parentPath);
  }

  if (action?.folder == null || action.folder === "") {
    await navigateToFolder(page, courseId);
    return null;
  }

  return navigatePath(page, courseId, [action.folder]);
}

async function ensureFolderInCurrentLevel(page, { name, color = null }) {
  const beforeItems = await listItems(page);
  const existing = beforeItems.find((item) => item.type === "folder" && item.name === name);
  if (existing) {
    console.log(`  Folder already exists: "${name}" (${existing.id})`);
    return { status: "skipped", folder: existing };
  }

  await clickAddMaterials(page);
  await sleep(1500);
  await clickAddFolder(page);

  const popupLoaded = await waitForPopup(page);
  if (!popupLoaded) {
    throw new Error("Folder creation popup did not appear");
  }

  await fillFolderForm(page, { name, color });
  await submitPopup(page);

  const afterItems = await listItems(page);
  const created = afterItems.find((item) => item.type === "folder" && item.name === name);
  if (!created) {
    throw new Error(`Could not verify folder creation for "${name}"`);
  }

  console.log(`  Created folder: "${name}" (${created.id})`);
  return { status: "created", folder: created };
}

function lessonLinksForEntry(lesson, entry) {
  const urls = entry?.urls || {};
  const links = [];

  for (const { key, title } of LINK_TYPES) {
    if (!urls[key]) continue;
    links.push({
      key,
      title: `${title} \u2014 ${lesson}`,
      url: urls[key],
    });
  }

  return links;
}

async function postLinkInCurrentFolder(page, courseId, folderId, { title, url }) {
  const beforeItems = await listItems(page);
  const existing = beforeItems.find((item) => item.name === title);
  if (existing) {
    console.log(`    Link already exists: "${title}"`);
    return { status: "skipped", item: existing };
  }

  await clickAddMaterials(page);
  await sleep(1500);
  await clickAddFileLink(page);
  await sleep(1500);
  await clickLinkOption(page);

  const popupLoaded = await waitForPopup(page);
  if (!popupLoaded) {
    throw new Error("Link popup did not appear");
  }

  await sleep(1000);
  await fillLinkForm(page, { title, url });
  await submitPopup(page);

  await navigateToFolder(page, courseId, folderId);

  const afterItems = await listItems(page);
  const posted = afterItems.find((item) => item.name === title);
  if (!posted) {
    throw new Error(`Could not verify posted link "${title}"`);
  }

  console.log(`    Posted: ${title}`);
  return { status: "posted", item: posted };
}

async function executeCreateFolder(page, courseId, action, summary) {
  if (!action?.name) {
    throw new Error("create-folder action is missing name");
  }

  await navigateToCreateParent(page, courseId, action);
  const result = await ensureFolderInCurrentLevel(page, {
    name: action.name,
    color: action.color ?? null,
  });

  if (result.status === "created") {
    summary.folders.created += 1;
    return "completed";
  }

  summary.folders.skipped += 1;
  return "skipped";
}

async function executeMoveFolder(page, courseId, action, summary) {
  if (!action?.name || !action?.into) {
    throw new Error("move-folder action requires name and into");
  }

  await navigateToRef(page, courseId, action.from ?? null);
  const sourceFolder = await findFolderByName(page, action.name);

  if (!sourceFolder) {
    await navigateToRef(page, courseId, action.into);
    const existingInTarget = await findFolderByName(page, action.name);

    if (existingInTarget) {
      console.log(`  Folder already moved: "${action.name}" (${existingInTarget.id})`);
      summary.folders.skipped += 1;
      return "skipped";
    }
  }

  const moved = await cmdMoveFolder(page, courseId, {
    name: action.name,
    into: action.into,
    from: action.from ?? null,
  });

  if (!moved) {
    summary.folders.moveFailed += 1;
    return "failed";
  }

  summary.folders.moved += 1;
  return "completed";
}

async function executePostLinks(page, courseId, action, registry, summary) {
  const targetFolderId = await navigateToPostTarget(page, courseId, action);
  let postedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const lessons = Array.isArray(action?.lessons) ? action.lessons : [];

  for (const lesson of lessons) {
    const lessonKey = String(lesson);
    const entry = registry[lessonKey];

    if (!entry) {
      summary.lessonsMissing += 1;
      failedCount += 1;
      console.error(`  Missing registry entry for lesson "${lessonKey}"`);
      continue;
    }

    console.log(`  Lesson ${lessonKey}`);
    const links = lessonLinksForEntry(lessonKey, entry);

    for (const link of links) {
      try {
        const result = await postLinkInCurrentFolder(page, courseId, targetFolderId, link);
        if (result.status === "posted") {
          postedCount += 1;
          summary.links.posted += 1;
        } else {
          skippedCount += 1;
          summary.links.skipped += 1;
        }
      } catch (error) {
        failedCount += 1;
        summary.links.failed += 1;
        console.error(`    Failed: ${link.title} (${error.message})`);
        await navigateToFolder(page, courseId, targetFolderId);
      }
    }
  }

  if (failedCount > 0) {
    return "failed";
  }
  if (postedCount === 0 && skippedCount > 0) {
    return "skipped";
  }
  if (postedCount === 0 && skippedCount === 0) {
    return "skipped";
  }
  return "completed";
}

function printSummary(summary) {
  console.log("\nSummary");
  console.log(`  Steps: ${summary.steps.completed} completed, ${summary.steps.skipped} skipped, ${summary.steps.failed} failed`);
  console.log(`  Folders: ${summary.folders.created} created, ${summary.folders.skipped} skipped, ${summary.folders.moved} moved, ${summary.folders.moveFailed} move failed`);
  console.log(`  Links: ${summary.links.posted} posted, ${summary.links.skipped} skipped, ${summary.links.failed} failed`);
  console.log(`  Missing lessons: ${summary.lessonsMissing}`);
}

async function main() {
  const planArg = process.argv[2];
  if (!planArg || planArg === "--help" || planArg === "-h") {
    printUsage();
    process.exit(planArg ? 0 : 1);
  }

  const planPath = resolve(process.cwd(), planArg);
  const plan = readJson(planPath);
  const registry = readJson(REGISTRY_PATH);
  const courseId = String(plan?.courseId || "");
  const actions = Array.isArray(plan?.actions) ? plan.actions : null;

  if (!courseId) {
    throw new Error("Plan is missing courseId");
  }
  if (!actions) {
    throw new Error("Plan is missing an actions array");
  }

  const summary = {
    steps: { completed: 0, skipped: 0, failed: 0 },
    folders: { created: 0, skipped: 0, moved: 0, moveFailed: 0 },
    links: { posted: 0, skipped: 0, failed: 0 },
    lessonsMissing: 0,
  };

  ({ chromium } = await import("playwright"));
  ({ connectCDP } = await import("./lib/cdp-connect.mjs"));
  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology.com" });

  try {
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      const currentStep = stepNumber(action, index);
      console.log(`\nStep ${currentStep}: ${action.type} \u2014 ${stepName(action)}`);

      let status = "failed";
      try {
        switch (action?.type) {
          case "create-folder":
            status = await executeCreateFolder(page, courseId, action, summary);
            break;
          case "move-folder":
            status = await executeMoveFolder(page, courseId, action, summary);
            break;
          case "post-links":
            status = await executePostLinks(page, courseId, action, registry, summary);
            break;
          default:
            throw new Error(`Unsupported action type "${action?.type}"`);
        }
      } catch (error) {
        console.error(`  Step failed: ${error.message}`);
        status = "failed";
      }

      if (status === "completed") {
        summary.steps.completed += 1;
      } else if (status === "skipped") {
        summary.steps.skipped += 1;
      } else {
        summary.steps.failed += 1;
      }
    }
  } finally {
    printSummary(summary);
    console.log("\nDisconnecting from browser (CDP). Browser remains open.");
    await browser?.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
