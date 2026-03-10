import {
  navigateToFolder,
  listItems,
  resolveFolder,
  sleep
} from "./schoology-dom.mjs";

function isFolderId(value) {
  return /^\d+$/.test(String(value).trim());
}

function formatListItem(item) {
  if (item.type === "folder") {
    return `[folder] [${item.id}] ${item.name} (${item.color || "blue"})`;
  }
  return `[link] [${item.id}] ${item.name}`;
}

function formatTreeItem(item) {
  if (item.type === "folder") {
    return `${item.name} (${item.color || "blue"})`;
  }
  return `[link] ${item.name}`;
}

async function resolveStartFolder(page, courseId, inFolder) {
  if (inFolder === null || inFolder === undefined) {
    return null;
  }

  if (isFolderId(inFolder)) {
    return { id: String(inFolder).trim(), name: String(inFolder).trim() };
  }

  const resolved = await resolveFolder(page, courseId, inFolder);
  if (!resolved) {
    throw new Error(`Could not resolve folder: ${inFolder}`);
  }
  return resolved;
}

async function printListLevel(page, courseId, folderId, indent, recursive) {
  if (folderId === null || folderId === undefined) {
    await navigateToFolder(page, courseId);
  } else {
    await navigateToFolder(page, courseId, folderId);
  }
  const items = await listItems(page);

  for (const item of items) {
    console.log(`${indent}${formatListItem(item)}`);
  }

  if (recursive) {
    for (const item of items) {
      if (item.type !== "folder") continue;
      await sleep(100);
      await printListLevel(page, courseId, item.id, `${indent}  `, true);
    }
  }

  return items;
}

async function printTreeLevel(page, courseId, items, prefix, currentDepth, maxDepth) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const isLast = index === items.length - 1;
    const branch = isLast ? "└── " : "├── ";

    console.log(`${prefix}${branch}${formatTreeItem(item)}`);

    if (item.type !== "folder" || currentDepth >= maxDepth) {
      continue;
    }

    await sleep(100);
    await navigateToFolder(page, courseId, item.id);
    const children = await listItems(page);
    const childPrefix = `${prefix}${isLast ? "    " : "│   "}`;
    await printTreeLevel(page, courseId, children, childPrefix, currentDepth + 1, maxDepth);
  }
}

export async function cmdList(page, courseId, { inFolder, recursive } = {}) {
  const folder = await resolveStartFolder(page, courseId, inFolder);
  const folderId = folder?.id ?? null;
  return printListLevel(page, courseId, folderId, "", Boolean(recursive));
}

export async function cmdTree(page, courseId, { depth = Infinity } = {}) {
  const maxDepth = Number.isFinite(depth) ? Math.max(0, depth) : Infinity;

  await navigateToFolder(page, courseId);
  const items = await listItems(page);
  await printTreeLevel(page, courseId, items, "", 0, maxDepth);
  return items;
}
